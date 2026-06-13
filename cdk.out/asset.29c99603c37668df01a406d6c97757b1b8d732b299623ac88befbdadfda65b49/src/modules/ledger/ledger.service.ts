import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type LedgerAccount,
  type LedgerTransaction,
  type PrismaClient,
  type TransactionType
} from "@prisma/client";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { toDecimal } from "../../common/money/money.js";

export interface LedgerAccountCommand {
  accountId: string;
  accountNumber: string;
  userId: string;
  currency: "GBP";
}

export interface PostLedgerTransactionCommand {
  accountNumber: string;
  userId: string;
  type: TransactionType;
  amount: number;
  currency: "GBP";
  reference?: string;
  idempotencyKey?: string;
  requestId?: string;
  correlationId?: string;
}

export interface LedgerTransactionResponse {
  id: string;
  amount: number;
  currency: string;
  type: TransactionType;
  reference?: string;
  userId: string;
  createdTimestamp: string;
}

export interface LedgerGateway {
  createAccount(command: LedgerAccountCommand): Promise<LedgerAccount>;
  getBalance(accountNumber: string): Promise<number>;
  getBalances(accountNumbers: string[]): Promise<Record<string, number>>;
  closeAccount(accountNumber: string): Promise<void>;
  postTransaction(
    command: PostLedgerTransactionCommand
  ): Promise<LedgerTransactionResponse>;
  listTransactions(accountNumber: string): Promise<LedgerTransactionResponse[]>;
  getTransaction(
    accountNumber: string,
    transactionId: string
  ): Promise<LedgerTransactionResponse>;
}

function mapTransaction(
  transaction: LedgerTransaction
): LedgerTransactionResponse {
  return {
    id: transaction.transactionId,
    amount: Number(transaction.amount.toFixed(2)),
    currency: transaction.currency,
    type: transaction.type,
    ...(transaction.reference ? { reference: transaction.reference } : {}),
    userId: transaction.userId,
    createdTimestamp: transaction.createdAt.toISOString()
  };
}

function requestHash(command: PostLedgerTransactionCommand): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        accountNumber: command.accountNumber,
        userId: command.userId,
        type: command.type,
        amount: command.amount.toFixed(2),
        currency: command.currency,
        reference: command.reference ?? null
      })
    )
    .digest("hex");
}

export class LedgerService implements LedgerGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly maxBalance = new Prisma.Decimal("10000.00")
  ) {}

  async createAccount(command: LedgerAccountCommand): Promise<LedgerAccount> {
    const existing = await this.db.ledgerAccount.findUnique({
      where: { accountNumber: command.accountNumber }
    });
    if (existing) {
      if (
        existing.accountId === command.accountId &&
        existing.userId === command.userId &&
        existing.currency === command.currency
      ) {
        return existing;
      }
      throw new AppError(
        409,
        ErrorCode.CONFLICT,
        "Ledger account already exists with different data"
      );
    }

    return this.db.ledgerAccount.create({ data: command });
  }

  async getBalance(accountNumber: string): Promise<number> {
    const account = await this.activeAccount(accountNumber);
    return Number(account.availableBalance.toFixed(2));
  }

  async getBalances(accountNumbers: string[]): Promise<Record<string, number>> {
    if (accountNumbers.length === 0) return {};
    const accounts = await this.db.ledgerAccount.findMany({
      where: {
        accountNumber: { in: accountNumbers },
        status: "ACTIVE"
      }
    });
    if (accounts.length !== new Set(accountNumbers).size) {
      throw new AppError(
        503,
        ErrorCode.INTERNAL_ERROR,
        "Ledger account projection is incomplete"
      );
    }
    return Object.fromEntries(
      accounts.map((account) => [
        account.accountNumber,
        Number(account.availableBalance.toFixed(2))
      ])
    );
  }

  async closeAccount(accountNumber: string): Promise<void> {
    const existing = await this.db.ledgerAccount.findUnique({
      where: { accountNumber }
    });
    if (!existing) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Ledger account was not found");
    }
    if (existing.status === "CLOSED") return;
    await this.db.ledgerAccount.update({
      where: { accountNumber },
      data: { status: "CLOSED", version: { increment: 1 } }
    });
  }

  async postTransaction(
    command: PostLedgerTransactionCommand
  ): Promise<LedgerTransactionResponse> {
    const hash = requestHash(command);
    if (command.idempotencyKey) {
      const previous = await this.db.ledgerIdempotencyKey.findUnique({
        where: {
          userId_accountNumber_idempotencyKey: {
            userId: command.userId,
            accountNumber: command.accountNumber,
            idempotencyKey: command.idempotencyKey
          }
        }
      });
      if (previous) {
        if (previous.requestHash !== hash) {
          throw new AppError(
            409,
            ErrorCode.CONFLICT,
            "Idempotency key was reused for a different transaction"
          );
        }
        if (previous.responsePayload) {
          return previous.responsePayload as unknown as LedgerTransactionResponse;
        }
      }
    }

    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "LedgerAccount"
          WHERE "accountNumber" = ${command.accountNumber}
          FOR UPDATE
        `;
        const account = await tx.ledgerAccount.findUnique({
          where: { accountNumber: command.accountNumber }
        });
        if (!account || account.status !== "ACTIVE") {
          throw new AppError(404, ErrorCode.NOT_FOUND, "Bank account was not found");
        }

        const amount = toDecimal(command.amount);
        const nextBalance =
          command.type === "deposit"
            ? account.availableBalance.add(amount)
            : account.availableBalance.sub(amount);
        if (nextBalance.isNegative()) {
          throw new AppError(
            422,
            ErrorCode.INSUFFICIENT_FUNDS,
            "Insufficient funds to process transaction"
          );
        }
        if (nextBalance.greaterThan(this.maxBalance)) {
          throw new AppError(
            422,
            ErrorCode.BALANCE_LIMIT_EXCEEDED,
            "Maximum account balance would be exceeded"
          );
        }

        if (command.idempotencyKey) {
          await tx.ledgerIdempotencyKey.create({
            data: {
              idempotencyKey: command.idempotencyKey,
              userId: command.userId,
              accountNumber: command.accountNumber,
              requestHash: hash,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
          });
        }

        const transactionId = `tan-${randomUUID().replaceAll("-", "")}`;
        const transaction = await tx.ledgerTransaction.create({
          data: {
            transactionId,
            ledgerAccountId: account.id,
            accountId: account.accountId,
            accountNumber: account.accountNumber,
            userId: command.userId,
            type: command.type,
            amount,
            currency: command.currency,
            reference: command.reference,
            idempotencyKey: command.idempotencyKey
          }
        });
        await tx.ledgerEntry.create({
          data: {
            ledgerTransactionId: transaction.id,
            ledgerAccountId: account.id,
            accountId: account.accountId,
            direction: command.type === "deposit" ? "CREDIT" : "DEBIT",
            amount,
            currency: command.currency,
            balanceAfter: nextBalance
          }
        });
        await tx.ledgerAccount.update({
          where: { id: account.id },
          data: {
            availableBalance: nextBalance,
            version: { increment: 1 }
          }
        });

        const response = mapTransaction(transaction);
        const eventId = randomUUID();
        await tx.ledgerOutboxEvent.create({
          data: {
            eventId,
            eventType: "TransactionPosted",
            aggregateId: account.accountNumber,
            payload: {
              eventId,
              eventType: "TransactionPosted",
              occurredAt: transaction.createdAt.toISOString(),
              transactionId,
              accountNumber: account.accountNumber,
              accountId: account.accountId,
              userId: command.userId,
              type: command.type,
              amount: command.amount.toFixed(2),
              currency: command.currency,
              balanceAfter: nextBalance.toFixed(2),
              reference: command.reference ?? null,
              requestId: command.requestId ?? null,
              correlationId: command.correlationId ?? null
            }
          }
        });
        if (command.idempotencyKey) {
          await tx.ledgerIdempotencyKey.update({
            where: {
              userId_accountNumber_idempotencyKey: {
                userId: command.userId,
                accountNumber: command.accountNumber,
                idempotencyKey: command.idempotencyKey
              }
            },
            data: {
              status: "COMPLETED",
              responsePayload: response as unknown as Prisma.InputJsonValue
            }
          });
        }
        return response;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async listTransactions(
    accountNumber: string
  ): Promise<LedgerTransactionResponse[]> {
    const account = await this.activeAccount(accountNumber);
    return (
      await this.db.ledgerTransaction.findMany({
        where: { accountId: account.accountId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    ).map(mapTransaction);
  }

  async getTransaction(
    accountNumber: string,
    transactionId: string
  ): Promise<LedgerTransactionResponse> {
    const account = await this.activeAccount(accountNumber);
    const transaction = await this.db.ledgerTransaction.findUnique({
      where: { transactionId }
    });
    if (!transaction || transaction.ledgerAccountId !== account.id) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Transaction was not found");
    }
    return mapTransaction(transaction);
  }

  private async activeAccount(accountNumber: string): Promise<LedgerAccount> {
    const account = await this.db.ledgerAccount.findUnique({
      where: { accountNumber }
    });
    if (!account || account.status !== "ACTIVE") {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Ledger account was not found");
    }
    return account;
  }
}
