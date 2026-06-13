import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  type LedgerAccount,
  type LedgerTransaction,
  type PrismaClient,
} from "@prisma/client";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { toDecimal } from "../../common/money/money.js";
import {
  MILLISECONDS_PER_SECOND,
  MONEY_DECIMAL_PLACES,
  SECONDS_PER_HOUR,
} from "../../common/constants.js";
import type {
  LedgerAccountCommand,
  LedgerAccountResponse,
  LedgerGateway,
  LedgerTransactionResponse,
  PostLedgerTransactionCommand,
} from "./ledger.contracts.js";
import { ledgerTransactionResponseSchema } from "./ledger.contracts.js";

const MAX_ACCOUNT_BALANCE = "10000.00";
const IDEMPOTENCY_RETENTION_HOURS = 24;
const IDEMPOTENCY_RETENTION_MS =
  IDEMPOTENCY_RETENTION_HOURS * SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND;

function mapTransaction(
  transaction: LedgerTransaction,
): LedgerTransactionResponse {
  return {
    id: transaction.transactionId,
    amount: Number(transaction.amount.toFixed(MONEY_DECIMAL_PLACES)),
    currency: "GBP",
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
    currency: "GBP",
    availableBalance: Number(
      account.availableBalance.toFixed(MONEY_DECIMAL_PLACES),
    ),
  };
}

function requestHash(command: PostLedgerTransactionCommand): string {
  // Bind an idempotency key to the business request. Reusing the key with
  // different money movement parameters is rejected rather than replayed.
  return createHash("sha256")
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
    .digest("hex");
}

export class LedgerService implements LedgerGateway {
  constructor(
    private readonly db: PrismaClient,
    private readonly maxBalance = new Prisma.Decimal(MAX_ACCOUNT_BALANCE),
  ) {}

  async createAccount(
    command: LedgerAccountCommand,
  ): Promise<LedgerAccountResponse> {
    const existing = await this.db.ledgerAccount.findUnique({
      where: { accountNumber: command.accountNumber },
    });
    if (existing) {
      if (
        existing.accountId === command.accountId &&
        existing.userId === command.userId &&
        existing.currency === command.currency
      ) {
        return mapAccount(existing);
      }
      throw new AppError(
        409,
        ErrorCode.CONFLICT,
        "Ledger account already exists with different data",
      );
    }

    return mapAccount(await this.db.ledgerAccount.create({ data: command }));
  }

  async getBalance(accountNumber: string): Promise<number> {
    const account = await this.activeAccount(accountNumber);
    return Number(account.availableBalance.toFixed(MONEY_DECIMAL_PLACES));
  }

  async getBalances(accountNumbers: string[]): Promise<Record<string, number>> {
    if (accountNumbers.length === 0) return {};
    const accounts = await this.db.ledgerAccount.findMany({
      where: {
        accountNumber: { in: accountNumbers },
        status: "ACTIVE",
      },
    });
    if (accounts.length !== new Set(accountNumbers).size) {
      throw new AppError(
        503,
        ErrorCode.INTERNAL_ERROR,
        "Ledger account projection is incomplete",
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
    const existing = await this.db.ledgerAccount.findUnique({
      where: { accountNumber },
    });
    if (!existing) {
      throw new AppError(
        404,
        ErrorCode.NOT_FOUND,
        "Ledger account was not found",
      );
    }
    if (existing.status === "CLOSED") return;
    await this.db.ledgerAccount.update({
      where: { accountNumber },
      data: { status: "CLOSED", version: { increment: 1 } },
    });
  }

  async postTransaction(
    command: PostLedgerTransactionCommand,
  ): Promise<LedgerTransactionResponse> {
    const hash = requestHash(command);
    if (command.idempotencyKey) {
      const previous = await this.db.ledgerIdempotencyKey.findUnique({
        where: {
          userId_accountNumber_idempotencyKey: {
            userId: command.userId,
            accountNumber: command.accountNumber,
            idempotencyKey: command.idempotencyKey,
          },
        },
      });
      if (previous) {
        if (previous.requestHash !== hash) {
          throw new AppError(
            409,
            ErrorCode.CONFLICT,
            "Idempotency key was reused for a different transaction",
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

    return this.db.$transaction(
      async (tx) => {
        // Lock the account before reading its balance. Concurrent movements for
        // one account are therefore calculated in a deterministic sequence.
        await tx.$queryRaw`
          SELECT "id"
          FROM "LedgerAccount"
          WHERE "accountNumber" = ${command.accountNumber}
          FOR UPDATE
        `;
        const account = await tx.ledgerAccount.findUnique({
          where: { accountNumber: command.accountNumber },
        });
        if (!account || account.status !== "ACTIVE") {
          throw new AppError(
            404,
            ErrorCode.NOT_FOUND,
            "Bank account was not found",
          );
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
            "Insufficient funds to process transaction",
          );
        }
        if (nextBalance.greaterThan(this.maxBalance)) {
          throw new AppError(
            422,
            ErrorCode.BALANCE_LIMIT_EXCEEDED,
            "Maximum account balance would be exceeded",
          );
        }

        if (command.idempotencyKey) {
          // The unique record is created inside the money transaction, closing
          // the race between concurrent requests using the same key.
          await tx.ledgerIdempotencyKey.create({
            data: {
              idempotencyKey: command.idempotencyKey,
              userId: command.userId,
              accountNumber: command.accountNumber,
              requestHash: hash,
              expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
            },
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
            ...(command.reference !== undefined
              ? { reference: command.reference }
              : {}),
            ...(command.idempotencyKey !== undefined
              ? { idempotencyKey: command.idempotencyKey }
              : {}),
          },
        });
        await tx.ledgerEntry.create({
          data: {
            ledgerTransactionId: transaction.id,
            ledgerAccountId: account.id,
            accountId: account.accountId,
            direction: command.type === "deposit" ? "CREDIT" : "DEBIT",
            amount,
            currency: command.currency,
            balanceAfter: nextBalance,
          },
        });
        await tx.ledgerAccount.update({
          where: { id: account.id },
          data: {
            availableBalance: nextBalance,
            version: { increment: 1 },
          },
        });

        // Commit the event with the ledger mutation. SQS delivery can then be
        // retried independently without losing an already committed event.
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
              amount: command.amount.toFixed(MONEY_DECIMAL_PLACES),
              currency: command.currency,
              balanceAfter: nextBalance.toFixed(MONEY_DECIMAL_PLACES),
              reference: command.reference ?? null,
              requestId: command.requestId ?? null,
              correlationId: command.correlationId ?? null,
            },
          },
        });
        if (command.idempotencyKey) {
          // Persist the exact response so later retries remain stable.
          await tx.ledgerIdempotencyKey.update({
            where: {
              userId_accountNumber_idempotencyKey: {
                userId: command.userId,
                accountNumber: command.accountNumber,
                idempotencyKey: command.idempotencyKey,
              },
            },
            data: {
              status: "COMPLETED",
              responsePayload: { ...response },
            },
          });
        }
        return response;
      },
      // Serializable isolation is defense in depth around the explicit row lock
      // and protects future multi-row ledger invariants.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listTransactions(
    accountNumber: string,
  ): Promise<LedgerTransactionResponse[]> {
    const account = await this.activeAccount(accountNumber);
    return (
      await this.db.ledgerTransaction.findMany({
        where: { accountId: account.accountId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    ).map(mapTransaction);
  }

  async getTransaction(
    accountNumber: string,
    transactionId: string,
  ): Promise<LedgerTransactionResponse> {
    const account = await this.activeAccount(accountNumber);
    const transaction = await this.db.ledgerTransaction.findUnique({
      where: { transactionId },
    });
    if (!transaction || transaction.ledgerAccountId !== account.id) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Transaction was not found");
    }
    return mapTransaction(transaction);
  }

  private async activeAccount(accountNumber: string): Promise<LedgerAccount> {
    const account = await this.db.ledgerAccount.findUnique({
      where: { accountNumber },
    });
    if (!account || account.status !== "ACTIVE") {
      throw new AppError(
        404,
        ErrorCode.NOT_FOUND,
        "Ledger account was not found",
      );
    }
    return account;
  }
}
