import type { AccountsService } from '../accounts/accounts.service.js';
import type { CreateTransactionInput } from './transactions.schemas.js';
import type { LedgerGateway } from '../ledger/domain/ledger.contracts.js';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';

export class TransactionsService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly ledger: LedgerGateway,
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
  ) {}

  async create(
    accountNumber: string,
    userId: string,
    input: CreateTransactionInput,
    idempotencyKey?: string,
  ) {
    await this.accounts.getAuthorized(accountNumber, userId);
    this.logger.info(
      { accountNumber, userId },
      'Posting transaction to Ledger',
    );
    return this.ledger.postTransaction({
      accountNumber,
      userId,
      amount: input.amount,
      currency: input.currency,
      type: input.type,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  async list(accountNumber: string, userId: string) {
    await this.accounts.getAuthorized(accountNumber, userId);
    return {
      transactions: await this.ledger.listTransactions(accountNumber),
    };
  }

  async get(accountNumber: string, transactionId: string, userId: string) {
    await this.accounts.getAuthorized(accountNumber, userId);
    return this.ledger.getTransaction(accountNumber, transactionId);
  }
}
