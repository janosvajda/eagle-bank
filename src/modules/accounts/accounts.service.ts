import { randomInt } from 'node:crypto';
import { AccountStatus, Prisma } from '@prisma/client';
import { constants as httpConstants } from 'node:http2';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { mapAccount } from './accounts.mapper.js';
import type { AccountsRepository } from './accounts.repository.js';
import type {
  CreateAccountInput,
  UpdateAccountInput,
} from './accounts.schemas.js';
import type { LedgerGateway } from '../ledger/ledger.contracts.js';
import { PrismaErrorCode } from '../../common/errors/prisma-error-codes.js';
import { Currency } from '../../common/domain/banking.js';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';

const ACCOUNT_NUMBER_RANGE = 1000000;
const ACCOUNT_NUMBER_ALLOCATION_ATTEMPTS = 5;
const ACCOUNT_NUMBER_PREFIX = '01';
const ACCOUNT_NUMBER_SUFFIX_LENGTH = 6;

export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly ledger?: LedgerGateway,
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
  ) {}

  private generateAccountNumber(): string {
    return `${ACCOUNT_NUMBER_PREFIX}${randomInt(0, ACCOUNT_NUMBER_RANGE)
      .toString()
      .padStart(ACCOUNT_NUMBER_SUFFIX_LENGTH, '0')}`;
  }

  async create(userId: string, input: CreateAccountInput) {
    // Account numbers are random within the required 01xxxxxx range. A unique
    // database constraint resolves races; only that collision is retried.
    for (
      let attempt = 0;
      attempt < ACCOUNT_NUMBER_ALLOCATION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const account = await this.accounts.create({
          accountNumber: this.generateAccountNumber(),
          name: input.name,
          accountType: input.accountType,
          userId,
          status: this.ledger
            ? AccountStatus.PENDING_LEDGER_CREATION
            : AccountStatus.ACTIVE,
        });
        if (!this.ledger) return mapAccount(account);

        // Account metadata is created first, then activated only after Ledger
        // confirms its balance-owning account exists.
        try {
          const ledgerAccount = await this.ledger.createAccount({
            accountId: account.id,
            accountNumber: account.accountNumber,
            userId,
            currency: Currency.GBP,
          });
          const active = await this.accounts.setStatus(
            account.accountNumber,
            AccountStatus.ACTIVE,
          );
          return mapAccount(active, ledgerAccount.availableBalance);
        } catch (error) {
          // Persist the partial failure so reconciliation can recover it instead
          // of presenting an account whose ledger projection is missing.
          await this.accounts.setStatus(
            account.accountNumber,
            AccountStatus.LEDGER_CREATION_FAILED,
          );
          this.logger.error(
            {
              accountNumber: account.accountNumber,
              err: error,
              userId,
            },
            'Ledger account creation failed after bank account persistence',
          );
          throw error;
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
        ) {
          this.logger.warn(
            { attempt, userId },
            'Generated bank account number collided with an existing account',
          );
          continue;
        }
        this.logger.error(
          { err: error, userId },
          'Bank account creation failed',
        );
        throw error;
      }
    }
    this.logger.error(
      {
        allocationAttempts: ACCOUNT_NUMBER_ALLOCATION_ATTEMPTS,
        userId,
      },
      'Bank account number allocation attempts exhausted',
    );
    throw new AppError(
      httpConstants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
      ErrorCode.INTERNAL_ERROR,
      'Unable to allocate account number',
    );
  }

  async getAuthorized(accountNumber: string, userId: string) {
    const account = await this.accounts.findByNumber(accountNumber);
    if (!account || account.status !== AccountStatus.ACTIVE) {
      this.logger.warn({ accountNumber, userId }, 'Bank account lookup failed');
      throw new AppError(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Bank account was not found',
      );
    }
    if (account.userId !== userId) {
      this.logger.warn(
        { accountNumber, ownerId: account.userId, userId },
        'Bank account access was forbidden',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You are not allowed to access this bank account',
      );
    }
    return account;
  }

  async list(userId: string) {
    const accounts = await this.accounts.listByUser(userId);
    if (!this.ledger)
      return { accounts: accounts.map((account) => mapAccount(account)) };
    const balances = await this.ledger.getBalances(
      accounts.map((account) => account.accountNumber),
    );
    return {
      accounts: accounts.map((account) =>
        mapAccount(account, balances[account.accountNumber]),
      ),
    };
  }

  async get(accountNumber: string, userId: string) {
    const account = await this.getAuthorized(accountNumber, userId);
    return mapAccount(
      account,
      this.ledger ? await this.ledger.getBalance(accountNumber) : undefined,
    );
  }

  async update(
    accountNumber: string,
    userId: string,
    input: UpdateAccountInput,
  ) {
    await this.getAuthorized(accountNumber, userId);
    const account = await this.accounts.update(accountNumber, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.accountType !== undefined
        ? { accountType: input.accountType }
        : {}),
    });
    return mapAccount(
      account,
      this.ledger ? await this.ledger.getBalance(accountNumber) : undefined,
    );
  }

  async delete(accountNumber: string, userId: string): Promise<void> {
    await this.getAuthorized(accountNumber, userId);
    if (this.ledger) {
      // Closing spans two services, so explicit states make this small saga
      // observable and recoverable when the Ledger call fails.
      await this.accounts.setStatus(
        accountNumber,
        AccountStatus.PENDING_LEDGER_CLOSURE,
      );
      try {
        await this.ledger.closeAccount(accountNumber);
        await this.accounts.close(accountNumber);
        return;
      } catch (error) {
        await this.accounts.setStatus(
          accountNumber,
          AccountStatus.LEDGER_CLOSURE_FAILED,
        );
        this.logger.error(
          { accountNumber, err: error, userId },
          'Ledger account closure failed during bank account deletion',
        );
        throw error;
      }
    }
    try {
      await this.accounts.delete(accountNumber);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PrismaErrorCode.FOREIGN_KEY_CONSTRAINT
      ) {
        this.logger.warn(
          { accountNumber, userId },
          'Bank account deletion rejected because transactions remain',
        );
        throw new AppError(
          httpConstants.HTTP_STATUS_CONFLICT,
          ErrorCode.CONFLICT,
          'A bank account with transactions cannot be deleted',
        );
      }
      this.logger.error(
        { accountNumber, err: error, userId },
        'Bank account deletion failed',
      );
      throw error;
    }
  }
}
