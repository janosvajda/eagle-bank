import {
  IdempotencyStatus,
  LedgerEntryDirection,
  LedgerAccountStatus,
  Prisma,
  TransactionType,
  type LedgerAccount,
  type LedgerIdempotencyKey,
  type LedgerTransaction,
  type PrismaClient,
} from '@prisma/client';
import type {
  LedgerAccountCommand,
  LedgerTransactionResponse,
} from './ledger.contracts.js';

export interface LedgerTransactionRecord {
  transactionId: string;
  ledgerAccountId: string;
  accountId: string;
  accountNumber: string;
  userId: string;
  type: TransactionType;
  amount: Prisma.Decimal;
  currency: string;
  reference?: string;
  idempotencyKey?: string;
}

export interface LedgerEntryRecord {
  ledgerTransactionId: string;
  ledgerAccountId: string;
  accountId: string;
  direction: LedgerEntryDirection;
  amount: Prisma.Decimal;
  currency: string;
  balanceAfter: Prisma.Decimal;
}

export interface LedgerOutboxRecord {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
}

export interface LedgerIdempotencyRecord {
  idempotencyKey: string;
  userId: string;
  accountNumber: string;
  requestHash: string;
  expiresAt: Date;
}

export interface LedgerUnitOfWork {
  findAccount(accountNumber: string): Promise<LedgerAccount | null>;
  reserveBalance(
    account: LedgerAccount,
    nextBalance: Prisma.Decimal,
  ): Promise<boolean>;
  createIdempotency(record: LedgerIdempotencyRecord): Promise<void>;
  createTransaction(
    record: LedgerTransactionRecord,
  ): Promise<LedgerTransaction>;
  createEntry(record: LedgerEntryRecord): Promise<void>;
  createOutboxEvent(record: LedgerOutboxRecord): Promise<void>;
  completeIdempotency(
    userId: string,
    accountNumber: string,
    idempotencyKey: string,
    response: LedgerTransactionResponse,
  ): Promise<void>;
}

class PrismaLedgerUnitOfWork implements LedgerUnitOfWork {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  findAccount(accountNumber: string): Promise<LedgerAccount | null> {
    return this.transaction.ledgerAccount.findUnique({
      where: { accountNumber },
    });
  }

  async reserveBalance(
    account: LedgerAccount,
    nextBalance: Prisma.Decimal,
  ): Promise<boolean> {
    // The version predicate turns the balance write into a compare-and-swap.
    // A concurrent transaction can commit first, but it cannot be overwritten.
    const result = await this.transaction.ledgerAccount.updateMany({
      where: {
        id: account.id,
        status: LedgerAccountStatus.ACTIVE,
        version: account.version,
      },
      data: {
        availableBalance: nextBalance,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async createIdempotency(record: LedgerIdempotencyRecord): Promise<void> {
    await this.transaction.ledgerIdempotencyKey.create({ data: record });
  }

  createTransaction(
    record: LedgerTransactionRecord,
  ): Promise<LedgerTransaction> {
    return this.transaction.ledgerTransaction.create({ data: record });
  }

  async createEntry(record: LedgerEntryRecord): Promise<void> {
    await this.transaction.ledgerEntry.create({ data: record });
  }

  async createOutboxEvent(record: LedgerOutboxRecord): Promise<void> {
    await this.transaction.ledgerOutboxEvent.create({ data: record });
  }

  async completeIdempotency(
    userId: string,
    accountNumber: string,
    idempotencyKey: string,
    response: LedgerTransactionResponse,
  ): Promise<void> {
    await this.transaction.ledgerIdempotencyKey.update({
      where: {
        userId_accountNumber_idempotencyKey: {
          userId,
          accountNumber,
          idempotencyKey,
        },
      },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responsePayload: { ...response },
      },
    });
  }
}

export class LedgerRepository {
  constructor(private readonly database: PrismaClient) {}

  findAccount(accountNumber: string): Promise<LedgerAccount | null> {
    return this.database.ledgerAccount.findUnique({
      where: { accountNumber },
    });
  }

  findAccounts(accountNumbers: string[]): Promise<LedgerAccount[]> {
    return this.database.ledgerAccount.findMany({
      where: {
        accountNumber: { in: accountNumbers },
        status: LedgerAccountStatus.ACTIVE,
      },
    });
  }

  createAccount(command: LedgerAccountCommand): Promise<LedgerAccount> {
    return this.database.ledgerAccount.create({ data: command });
  }

  closeAccount(accountNumber: string): Promise<LedgerAccount> {
    return this.database.ledgerAccount.update({
      where: { accountNumber },
      data: {
        status: LedgerAccountStatus.CLOSED,
        version: { increment: 1 },
      },
    });
  }

  findIdempotency(
    userId: string,
    accountNumber: string,
    idempotencyKey: string,
  ): Promise<LedgerIdempotencyKey | null> {
    return this.database.ledgerIdempotencyKey.findUnique({
      where: {
        userId_accountNumber_idempotencyKey: {
          userId,
          accountNumber,
          idempotencyKey,
        },
      },
    });
  }

  listTransactions(accountId: string): Promise<LedgerTransaction[]> {
    return this.database.ledgerTransaction.findMany({
      where: { accountId },
      orderBy: [
        { createdAt: Prisma.SortOrder.asc },
        { id: Prisma.SortOrder.asc },
      ],
    });
  }

  findTransaction(transactionId: string): Promise<LedgerTransaction | null> {
    return this.database.ledgerTransaction.findUnique({
      where: { transactionId },
    });
  }

  runInTransaction<T>(
    operation: (unitOfWork: LedgerUnitOfWork) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(
      (transaction) => operation(new PrismaLedgerUnitOfWork(transaction)),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
