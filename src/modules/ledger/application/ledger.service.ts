import { constants as httpConstants } from 'node:http2';
import {
  LedgerAccountStatus,
  type LedgerAccount,
} from '../../../generated/prisma/client.js';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { toDecimal } from '../../../common/money/money.js';
import { MONEY_DECIMAL_PLACES } from '../../../common/constants.js';
import type {
  LedgerAccountCommand,
  LedgerAccountResponse,
  LedgerGateway,
  LedgerTransactionResponse,
  PostLedgerTransactionCommand,
} from '../domain/ledger.contracts.js';
import { LedgerRepository } from '../persistence/ledger.repository.js';
import { parseTransactionApiId } from '../../transactions/transaction-id.js';
import { parseUserApiId } from '../../users/user-id.js';
import {
  mapLedgerAccount,
  mapLedgerTransaction,
} from '../domain/ledger.mapper.js';
import { LedgerTransactionPoster } from './ledger-transaction-poster.js';
import { LEDGER_MAX_ACCOUNT_BALANCE } from '../domain/ledger.constants.js';
import { rejectLedgerOperation } from '../domain/ledger.errors.js';

export class LedgerService implements LedgerGateway {
  private readonly transactionPoster: LedgerTransactionPoster;

  constructor(
    private readonly ledger: LedgerRepository,
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
    maxBalance = toDecimal(LEDGER_MAX_ACCOUNT_BALANCE),
  ) {
    this.transactionPoster = new LedgerTransactionPoster(
      ledger,
      logger,
      maxBalance,
    );
  }

  async createAccount(
    command: LedgerAccountCommand,
  ): Promise<LedgerAccountResponse> {
    const userId = parseUserApiId(command.userId);
    if (userId === undefined) {
      this.reject(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Bank account was not found',
        { accountNumber: command.accountNumber, userId: command.userId },
      );
    }
    const existing = await this.ledger.findAccount(command.accountNumber);
    if (existing) {
      if (
        existing.accountId === command.accountId &&
        existing.userId === userId &&
        existing.currency === command.currency
      ) {
        return mapLedgerAccount(existing);
      }
      this.reject(
        httpConstants.HTTP_STATUS_CONFLICT,
        ErrorCode.CONFLICT,
        'Ledger account already exists with different data',
        { accountNumber: command.accountNumber, userId: command.userId },
      );
    }

    return mapLedgerAccount(
      await this.ledger.createAccount({ ...command, userId }),
    );
  }

  async getBalance(accountNumber: string): Promise<number> {
    const account = await this.activeAccount(accountNumber);
    return Number(account.availableBalance.toFixed(MONEY_DECIMAL_PLACES));
  }

  async getBalances(accountNumbers: string[]): Promise<Record<string, number>> {
    if (accountNumbers.length === 0) return {};
    const accounts = await this.ledger.findAccounts(accountNumbers);
    if (accounts.length !== new Set(accountNumbers).size) {
      this.reject(
        httpConstants.HTTP_STATUS_SERVICE_UNAVAILABLE,
        ErrorCode.INTERNAL_ERROR,
        'Ledger account projection is incomplete',
        {
          requestedAccountCount: new Set(accountNumbers).size,
          returnedAccountCount: accounts.length,
        },
      );
    }
    return Object.fromEntries(
      accounts.map((account) => [
        account.accountNumber,
        Number(account.availableBalance.toFixed(MONEY_DECIMAL_PLACES)),
      ]),
    );
  }

  async closeAccount(accountNumber: string): Promise<void> {
    const existing = await this.ledger.findAccount(accountNumber);
    if (!existing) {
      this.reject(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Ledger account was not found',
        { accountNumber },
      );
    }
    if (existing.status === LedgerAccountStatus.CLOSED) return;
    await this.ledger.closeAccount(accountNumber);
  }

  async postTransaction(
    command: PostLedgerTransactionCommand,
  ): Promise<LedgerTransactionResponse> {
    const userId = parseUserApiId(command.userId);
    if (userId === undefined) {
      this.reject(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Bank account was not found',
        { accountNumber: command.accountNumber, userId: command.userId },
      );
    }
    return this.transactionPoster.post(command, userId);
  }

  async listTransactions(
    accountNumber: string,
  ): Promise<LedgerTransactionResponse[]> {
    const account = await this.activeAccount(accountNumber);
    return (await this.ledger.listTransactions(account.accountId)).map(
      mapLedgerTransaction,
    );
  }

  async getTransaction(
    accountNumber: string,
    transactionId: string,
  ): Promise<LedgerTransactionResponse> {
    const account = await this.activeAccount(accountNumber);
    const databaseTransactionId = parseTransactionApiId(transactionId);
    const transaction =
      databaseTransactionId === undefined
        ? null
        : await this.ledger.findTransaction(databaseTransactionId);
    if (!transaction || transaction.ledgerAccountId !== account.id) {
      this.reject(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Transaction was not found',
        { accountNumber, transactionId },
      );
    }
    return mapLedgerTransaction(transaction);
  }

  private async activeAccount(accountNumber: string): Promise<LedgerAccount> {
    const account = await this.ledger.findAccount(accountNumber);
    if (!account || account.status !== LedgerAccountStatus.ACTIVE) {
      this.reject(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Ledger account was not found',
        { accountNumber },
      );
    }
    return account;
  }

  private reject(
    statusCode: number,
    code: ErrorCode,
    message: string,
    context: Record<string, string | number>,
  ): never {
    rejectLedgerOperation(this.logger, statusCode, code, message, context);
  }
}
