import { createHash, randomUUID } from 'node:crypto';
import { constants as httpConstants } from 'node:http2';
import {
  LedgerAccountStatus,
  LedgerEntryDirection,
  Prisma,
  type LedgerAccount,
  type LedgerTransaction,
} from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { toDecimal } from '../../common/money/money.js';
import {
  MILLISECONDS_PER_SECOND,
  MONEY_DECIMAL_PLACES,
  SECONDS_PER_HOUR,
} from '../../common/constants.js';
import type {
  LedgerAccountCommand,
  LedgerAccountResponse,
  LedgerGateway,
  LedgerTransactionResponse,
  PostLedgerTransactionCommand,
} from './ledger.contracts.js';
import { ledgerTransactionResponseSchema } from './ledger.contracts.js';
import { Currency, TransactionType } from '../../common/domain/banking.js';
import { LedgerEventType } from './ledger.constants.js';
import { LedgerConcurrencyError } from './ledger.errors.js';
import {
  LedgerRepository,
  type LedgerUnitOfWork,
} from './ledger.repository.js';

const MAX_ACCOUNT_BALANCE = '10000.00';
const IDEMPOTENCY_RETENTION_HOURS = 24;
const LEDGER_TRANSACTION_ATTEMPTS = 3;
const IDEMPOTENCY_RETENTION_MS =
  IDEMPOTENCY_RETENTION_HOURS * SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND;

function mapTransaction(
  transaction: LedgerTransaction,
): LedgerTransactionResponse {
  return {
    id: transaction.transactionId,
    amount: Number(transaction.amount.toFixed(MONEY_DECIMAL_PLACES)),
    currency: Currency.GBP,
    type: transaction.type,
    ...(transaction.reference ? { reference: transaction.reference } : {}),
    userId: transaction.userId,
    createdTimestamp: transaction.createdAt.toISOString(),
  };
}

function mapAccount(account: LedgerAccount): LedgerAccountResponse {
  return {
    accountId: account.accountId,
    accountNumber: account.accountNumber,
    userId: account.userId,
    currency: Currency.GBP,
    availableBalance: Number(
      account.availableBalance.toFixed(MONEY_DECIMAL_PLACES),
    ),
  };
}

function requestHash(command: PostLedgerTransactionCommand): string {
  // Bind an idempotency key to the business request. Reusing the key with
  // different money movement parameters is rejected rather than replayed.
  return createHash('sha256')
    .update(
      JSON.stringify({
        accountNumber: command.accountNumber,
        userId: command.userId,
        type: command.type,
        amount: command.amount.toFixed(MONEY_DECIMAL_PLACES),
        currency: command.currency,
        reference: command.reference ?? null,
      }),
    )
    .digest('hex');
}

export class LedgerService implements LedgerGateway {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
    private readonly maxBalance = new Prisma.Decimal(MAX_ACCOUNT_BALANCE),
  ) {}

  async createAccount(
    command: LedgerAccountCommand,
  ): Promise<LedgerAccountResponse> {
    const existing = await this.ledger.findAccount(command.accountNumber);
    if (existing) {
      if (
        existing.accountId === command.accountId &&
        existing.userId === command.userId &&
        existing.currency === command.currency
      ) {
        return mapAccount(existing);
      }
      this.reject(
        httpConstants.HTTP_STATUS_CONFLICT,
        ErrorCode.CONFLICT,
        'Ledger account already exists with different data',
        { accountNumber: command.accountNumber, userId: command.userId },
      );
    }

    return mapAccount(await this.ledger.createAccount(command));
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
    const hash = requestHash(command);
    if (command.idempotencyKey) {
      const previous = await this.ledger.findIdempotency(
        command.userId,
        command.accountNumber,
        command.idempotencyKey,
      );
      if (previous) {
        if (previous.requestHash !== hash) {
          this.reject(
            httpConstants.HTTP_STATUS_CONFLICT,
            ErrorCode.CONFLICT,
            'Idempotency key was reused for a different transaction',
            {
              accountNumber: command.accountNumber,
              idempotencyKey: command.idempotencyKey,
              userId: command.userId,
            },
          );
        }
        if (previous.responsePayload) {
          // A completed request returns its original response without applying
          // another balance mutation.
          return ledgerTransactionResponseSchema.parse(
            previous.responsePayload,
          );
        }
      }
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.ledger.runInTransaction((unitOfWork) =>
          this.postTransactionInUnitOfWork(unitOfWork, command, hash),
        );
      } catch (error) {
        if (
          error instanceof LedgerConcurrencyError &&
          attempt < LEDGER_TRANSACTION_ATTEMPTS
        ) {
          this.logger.warn(
            {
              accountNumber: command.accountNumber,
              attempt,
              userId: command.userId,
            },
            'Ledger transaction retried after a concurrent balance update',
          );
          continue;
        }
        if (error instanceof LedgerConcurrencyError) {
          this.logger.error(
            {
              accountNumber: command.accountNumber,
              attempts: attempt,
              err: error,
              userId: command.userId,
            },
            'Ledger transaction concurrency retries exhausted',
          );
          throw new AppError(
            httpConstants.HTTP_STATUS_SERVICE_UNAVAILABLE,
            ErrorCode.SERVICE_UNAVAILABLE,
            'Ledger service is temporarily unavailable',
          );
        }
        throw error;
      }
    }
  }

  private async postTransactionInUnitOfWork(
    unitOfWork: LedgerUnitOfWork,
    command: PostLedgerTransactionCommand,
    hash: string,
  ): Promise<LedgerTransactionResponse> {
    const account = await unitOfWork.findAccount(command.accountNumber);
    if (!account || account.status !== LedgerAccountStatus.ACTIVE) {
      this.reject(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Bank account was not found',
        {
          accountNumber: command.accountNumber,
          userId: command.userId,
        },
      );
    }

    const amount = toDecimal(command.amount);
    const nextBalance =
      command.type === TransactionType.DEPOSIT
        ? account.availableBalance.add(amount)
        : account.availableBalance.sub(amount);
    if (nextBalance.isNegative()) {
      this.reject(
        httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY,
        ErrorCode.INSUFFICIENT_FUNDS,
        'Insufficient funds to process transaction',
        {
          accountNumber: command.accountNumber,
          transactionType: command.type,
          userId: command.userId,
        },
      );
    }
    if (nextBalance.greaterThan(this.maxBalance)) {
      this.reject(
        httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY,
        ErrorCode.BALANCE_LIMIT_EXCEEDED,
        'Maximum account balance would be exceeded',
        {
          accountNumber: command.accountNumber,
          transactionType: command.type,
          userId: command.userId,
        },
      );
    }

    if (!(await unitOfWork.reserveBalance(account, nextBalance))) {
      throw new LedgerConcurrencyError();
    }

    if (command.idempotencyKey) {
      // The unique record is created inside the money transaction, closing
      // the race between concurrent requests using the same key.
      await unitOfWork.createIdempotency({
        idempotencyKey: command.idempotencyKey,
        userId: command.userId,
        accountNumber: command.accountNumber,
        requestHash: hash,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
      });
    }

    const transactionId = `tan-${randomUUID().replaceAll('-', '')}`;
    const transaction = await unitOfWork.createTransaction({
      transactionId,
      ledgerAccountId: account.id,
      accountId: account.accountId,
      accountNumber: account.accountNumber,
      userId: command.userId,
      type: command.type,
      amount,
      currency: command.currency,
      ...(command.reference !== undefined
        ? { reference: command.reference }
        : {}),
      ...(command.idempotencyKey !== undefined
        ? { idempotencyKey: command.idempotencyKey }
        : {}),
    });
    await unitOfWork.createEntry({
      ledgerTransactionId: transaction.id,
      ledgerAccountId: account.id,
      accountId: account.accountId,
      direction:
        command.type === TransactionType.DEPOSIT
          ? LedgerEntryDirection.CREDIT
          : LedgerEntryDirection.DEBIT,
      amount,
      currency: command.currency,
      balanceAfter: nextBalance,
    });

    // Commit the event with the ledger mutation. SQS delivery can then be
    // retried independently without losing an already committed event.
    const response = mapTransaction(transaction);
    const eventId = randomUUID();
    await unitOfWork.createOutboxEvent({
      eventId,
      eventType: LedgerEventType.TRANSACTION_POSTED,
      aggregateId: account.accountNumber,
      payload: {
        eventId,
        eventType: LedgerEventType.TRANSACTION_POSTED,
        occurredAt: transaction.createdAt.toISOString(),
        transactionId,
        accountNumber: account.accountNumber,
        accountId: account.accountId,
        userId: command.userId,
        type: command.type,
        amount: command.amount.toFixed(MONEY_DECIMAL_PLACES),
        currency: command.currency,
        balanceAfter: nextBalance.toFixed(MONEY_DECIMAL_PLACES),
        reference: command.reference ?? null,
        requestId: command.requestId ?? null,
        correlationId: command.correlationId ?? null,
      },
    });
    if (command.idempotencyKey) {
      // Persist the exact response so later retries remain stable.
      await unitOfWork.completeIdempotency(
        command.userId,
        command.accountNumber,
        command.idempotencyKey,
        response,
      );
    }
    return response;
  }

  async listTransactions(
    accountNumber: string,
  ): Promise<LedgerTransactionResponse[]> {
    const account = await this.activeAccount(accountNumber);
    return (await this.ledger.listTransactions(account.accountId)).map(
      mapTransaction,
    );
  }

  async getTransaction(
    accountNumber: string,
    transactionId: string,
  ): Promise<LedgerTransactionResponse> {
    const account = await this.activeAccount(accountNumber);
    const transaction = await this.ledger.findTransaction(transactionId);
    if (!transaction || transaction.ledgerAccountId !== account.id) {
      this.reject(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Transaction was not found',
        { accountNumber, transactionId },
      );
    }
    return mapTransaction(transaction);
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
    const log =
      statusCode >= httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR
        ? this.logger.error.bind(this.logger)
        : this.logger.warn.bind(this.logger);
    log({ ...context, code, statusCode }, message);
    throw new AppError(statusCode, code, message);
  }
}
