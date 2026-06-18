import { constants as httpConstants } from 'node:http2';
import {
  LedgerEntryDirection,
  Prisma,
} from '../../../../generated/prisma/client.js';
import type { FastifyBaseLogger } from 'fastify';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { TransactionType } from '../../../common/domain/banking.js';
import {
  type LedgerTransactionResponse,
  type PostLedgerTransactionCommand,
} from '../domain/ledger.contracts.js';
import {
  LedgerConcurrencyError,
  rejectLedgerOperation,
} from '../domain/ledger.errors.js';
import {
  LedgerRepository,
  type LedgerUnitOfWork,
} from '../persistence/ledger.repository.js';
import { mapLedgerTransaction } from '../domain/ledger.mapper.js';
import {
  LEDGER_FIRST_TRANSACTION_ATTEMPT,
  LEDGER_TRANSACTION_ATTEMPTS,
} from '../domain/ledger.constants.js';
import { LedgerIdempotencyHandler } from '../posting/ledger-idempotency.js';
import type {
  LedgerPostingContext,
  LedgerPostingState,
} from '../posting/ledger-posting.types.js';
import { LedgerPostingPolicy } from '../posting/ledger-posting-policy.js';
import { transactionPostedOutboxEvent } from '../posting/ledger-outbox-event.js';

// Coordinates one posted transaction. Domain checks, idempotency, and event
// payload construction live in collaborators so this class stays procedural.
export class LedgerTransactionPoster {
  private readonly idempotency: LedgerIdempotencyHandler;
  private readonly postingPolicy: LedgerPostingPolicy;

  constructor(
    private readonly ledger: LedgerRepository,
    private readonly logger: FastifyBaseLogger,
    maxBalance: Prisma.Decimal,
  ) {
    this.idempotency = new LedgerIdempotencyHandler(ledger, logger);
    this.postingPolicy = new LedgerPostingPolicy(logger, maxBalance);
  }

  async post(
    command: PostLedgerTransactionCommand,
    userId: bigint,
  ): Promise<LedgerTransactionResponse> {
    const context = this.idempotency.createContext(command, userId);
    const replayed = await this.idempotency.replay(context);
    return replayed ?? this.postWithRetries(context);
  }

  private async postWithRetries(
    context: LedgerPostingContext,
  ): Promise<LedgerTransactionResponse> {
    for (
      let attempt = LEDGER_FIRST_TRANSACTION_ATTEMPT;
      attempt <= LEDGER_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.ledger.runInTransaction((unitOfWork) =>
          this.postInUnitOfWork(unitOfWork, context),
        );
      } catch (error) {
        if (error instanceof LedgerConcurrencyError) {
          this.handleLedgerConcurrencyError(context.command, attempt, error);
        } else if (this.idempotency.isRace(error, context.command)) {
          return this.idempotency.replayRequired(context);
        } else {
          throw error;
        }
      }
    }

    return this.rejectExhaustedLedgerConcurrency(
      context.command,
      LEDGER_TRANSACTION_ATTEMPTS,
      new LedgerConcurrencyError(),
    );
  }

  private handleLedgerConcurrencyError(
    command: PostLedgerTransactionCommand,
    attempt: number,
    error: LedgerConcurrencyError,
  ): void {
    if (attempt === LEDGER_TRANSACTION_ATTEMPTS) {
      this.rejectExhaustedLedgerConcurrency(command, attempt, error);
    }
    this.logger.warn(
      {
        accountNumber: command.accountNumber,
        attempt,
        userId: command.userId,
      },
      'Ledger transaction retried after a concurrent balance update',
    );
  }

  private rejectExhaustedLedgerConcurrency(
    command: PostLedgerTransactionCommand,
    attempts: number,
    error: LedgerConcurrencyError,
  ): never {
    rejectLedgerOperation(
      this.logger,
      httpConstants.HTTP_STATUS_SERVICE_UNAVAILABLE,
      ErrorCode.SERVICE_UNAVAILABLE,
      'Ledger service is temporarily unavailable',
      {
        accountNumber: command.accountNumber,
        attempts,
        err: error,
        userId: command.userId,
      },
      'Ledger transaction concurrency retries exhausted',
    );
  }

  private async postInUnitOfWork(
    unitOfWork: LedgerUnitOfWork,
    context: LedgerPostingContext,
  ): Promise<LedgerTransactionResponse> {
    const state = await this.postingPolicy.prepareState(unitOfWork, context);
    await this.postingPolicy.reserveBalance(unitOfWork, state);
    await this.idempotency.createRecord(unitOfWork, context);
    const transaction = await unitOfWork.createTransaction({
      ledgerAccountId: state.account.id,
      accountId: state.account.accountId,
      accountNumber: state.account.accountNumber,
      userId: context.userId,
      type: context.command.type,
      amount: state.amount,
      currency: context.command.currency,
      ...(context.command.reference !== undefined
        ? { reference: context.command.reference }
        : {}),
      ...(context.command.idempotencyKey !== undefined
        ? { idempotencyKey: context.command.idempotencyKey }
        : {}),
    });
    await this.createLedgerEntry(unitOfWork, context, state, transaction.id);

    const response = mapLedgerTransaction(transaction);
    await this.createOutboxEvent(unitOfWork, context, state, response);
    await this.idempotency.completeRecord(unitOfWork, context, response);
    return response;
  }

  private async createLedgerEntry(
    unitOfWork: LedgerUnitOfWork,
    context: LedgerPostingContext,
    state: LedgerPostingState,
    ledgerTransactionId: bigint,
  ): Promise<void> {
    await unitOfWork.createEntry({
      ledgerTransactionId,
      ledgerAccountId: state.account.id,
      accountId: state.account.accountId,
      direction:
        context.command.type === TransactionType.DEPOSIT
          ? LedgerEntryDirection.CREDIT
          : LedgerEntryDirection.DEBIT,
      amount: state.amount,
      currency: context.command.currency,
      balanceAfter: state.nextBalance,
    });
  }

  private async createOutboxEvent(
    unitOfWork: LedgerUnitOfWork,
    context: LedgerPostingContext,
    state: LedgerPostingState,
    response: LedgerTransactionResponse,
  ): Promise<void> {
    // Commit the event with the ledger mutation. SQS delivery can then be
    // retried independently without losing an already committed event.
    await unitOfWork.createOutboxEvent(
      transactionPostedOutboxEvent(context, state, response),
    );
  }
}
