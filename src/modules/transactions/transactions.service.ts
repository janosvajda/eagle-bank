import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { toDecimal } from "../../common/money/money.js";
import type { AccountsService } from "../accounts/accounts.service.js";
import { mapTransaction } from "./transactions.mapper.js";
import type { TransactionsRepository } from "./transactions.repository.js";
import type { CreateTransactionInput } from "./transactions.schemas.js";

export class TransactionsService {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly accounts: AccountsService
  ) {}

  async create(
    accountNumber: string,
    userId: string,
    input: CreateTransactionInput
  ) {
    const account = await this.accounts.getAuthorized(accountNumber, userId);
    const amount = toDecimal(input.amount);

    const transaction = await this.transactions.db.$transaction(
      async (tx) => {
        if (input.type === "withdrawal") {
          const updated = await tx.bankAccount.updateMany({
            where: { id: account.id, balance: { gte: amount } },
            data: { balance: { decrement: amount } }
          });
          if (updated.count === 0) {
            throw new AppError(
              422,
              ErrorCode.INSUFFICIENT_FUNDS,
              "Insufficient funds to process transaction"
            );
          }
        } else {
          await tx.bankAccount.update({
            where: { id: account.id },
            data: { balance: { increment: amount } }
          });
        }

        return tx.transaction.create({
          data: {
            id: `tan-${randomUUID().replaceAll("-", "")}`,
            amount,
            currency: input.currency,
            type: input.type,
            reference: input.reference,
            userId,
            accountId: account.id
          }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return mapTransaction(transaction);
  }

  async list(accountNumber: string, userId: string) {
    const account = await this.accounts.getAuthorized(accountNumber, userId);
    return {
      transactions: (await this.transactions.listByAccount(account.id)).map(
        mapTransaction
      )
    };
  }

  async get(accountNumber: string, transactionId: string, userId: string) {
    const account = await this.accounts.getAuthorized(accountNumber, userId);
    const transaction = await this.transactions.findByIdAndAccount(
      transactionId,
      account.id
    );
    if (!transaction) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Transaction was not found");
    }
    return mapTransaction(transaction);
  }
}
