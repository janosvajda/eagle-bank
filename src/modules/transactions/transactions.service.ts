import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { constants as httpConstants } from 'node:http2';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { toDecimal } from '../../common/money/money.js';
import type { AccountsService } from '../accounts/accounts.service.js';
import { mapTransaction } from './transactions.mapper.js';
import type { TransactionsRepository } from './transactions.repository.js';
import type { CreateTransactionInput } from './transactions.schemas.js';
import type { LedgerGateway } from '../ledger/ledger.contracts.js';
import { TransactionType } from '../../common/domain/banking.js';

export class TransactionsService {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly accounts: AccountsService,
    private readonly ledger?: LedgerGateway,
  ) {}

  async create(
    accountNumber: string,
    userId: string,
    input: CreateTransactionInput,
    idempotencyKey?: string,
  ) {
    const account = await this.accounts.getAuthorized(accountNumber, userId);

    // Production delegates all balance ownership to Ledger. The local branch
    // remains as a compact fallback used by isolated tests.
    if (this.ledger) {
      return this.ledger.postTransaction({
        accountNumber,
        userId,
        amount: input.amount,
        currency: input.currency,
        type: input.type,
        ...(input.reference !== undefined
          ? { reference: input.reference }
          : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      });
    }
    const amount = toDecimal(input.amount);

    const transaction = await this.transactions.db.$transaction(
      async (tx) => {
        if (input.type === TransactionType.WITHDRAWAL) {
          // The conditional update checks and decrements in one SQL statement,
          // preventing concurrent withdrawals from overspending the balance.
          const updated = await tx.bankAccount.updateMany({
            where: { id: account.id, balance: { gte: amount } },
            data: { balance: { decrement: amount } },
          });
          if (updated.count === 0) {
            throw new AppError(
              httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY,
              ErrorCode.INSUFFICIENT_FUNDS,
              'Insufficient funds to process transaction',
            );
          }
        } else {
          await tx.bankAccount.update({
            where: { id: account.id },
            data: { balance: { increment: amount } },
          });
        }

        return tx.transaction.create({
          data: {
            id: `tan-${randomUUID().replaceAll('-', '')}`,
            amount,
            currency: input.currency,
            type: input.type,
            ...(input.reference !== undefined
              ? { reference: input.reference }
              : {}),
            userId,
            accountId: account.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return mapTransaction(transaction);
  }

  async list(accountNumber: string, userId: string) {
    const account = await this.accounts.getAuthorized(accountNumber, userId);
    if (this.ledger) {
      return {
        transactions: await this.ledger.listTransactions(accountNumber),
      };
    }
    return {
      transactions: (await this.transactions.listByAccount(account.id)).map(
        mapTransaction,
      ),
    };
  }

  async get(accountNumber: string, transactionId: string, userId: string) {
    const account = await this.accounts.getAuthorized(accountNumber, userId);
    if (this.ledger) {
      return this.ledger.getTransaction(accountNumber, transactionId);
    }
    const transaction = await this.transactions.findByIdAndAccount(
      transactionId,
      account.id,
    );
    if (!transaction) {
      throw new AppError(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Transaction was not found',
      );
    }
    return mapTransaction(transaction);
  }
}
