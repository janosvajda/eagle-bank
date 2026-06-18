import { createHash } from 'node:crypto';
import { constants as httpConstants } from 'node:http2';
import {
  Prisma,
  type LedgerIdempotencyKey,
} from '../../../../generated/prisma/client.js';
import type { FastifyBaseLogger } from 'fastify';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { MONEY_DECIMAL_PLACES } from '../../../common/constants.js';
import { PrismaErrorCode } from '../../../common/errors/prisma-error-codes.js';
import {
  ledgerTransactionResponseSchema,
  type LedgerTransactionResponse,
  type PostLedgerTransactionCommand,
} from '../domain/ledger.contracts.js';
import { LEDGER_IDEMPOTENCY_RETENTION_MS } from '../domain/ledger.constants.js';
import type { LedgerPostingContext } from './ledger-posting.types.js';
import {
  LedgerRepository,
  type LedgerUnitOfWork,
} from '../persistence/ledger.repository.js';
import { rejectLedgerOperation } from '../domain/ledger.errors.js';

// Keeps idempotent transaction behavior separate from balance posting:
// hash the business request, replay completed responses, and reject conflicts.
export function ledgerRequestHash(
  command: PostLedgerTransactionCommand,
): string {
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

export class LedgerIdempotencyHandler {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  createContext(
    command: PostLedgerTransactionCommand,
    userId: bigint,
  ): LedgerPostingContext {
    return { command, userId, requestHash: ledgerRequestHash(command) };
  }

  async replay(
    context: LedgerPostingContext,
  ): Promise<LedgerTransactionResponse | undefined> {
    if (!context.command.idempotencyKey) return undefined;
    const previous = await this.ledger.findIdempotency(
      context.userId,
      context.command.accountNumber,
      context.command.idempotencyKey,
    );
    return previous ? this.resolvePrevious(context, previous) : undefined;
  }

  async replayRequired(
    context: LedgerPostingContext,
  ): Promise<LedgerTransactionResponse> {
    const replayed = await this.replay(context);
    if (replayed) return replayed;
    this.rejectStillProcessing(context);
  }

  isRace(error: unknown, command: PostLedgerTransactionCommand): boolean {
    return (
      command.idempotencyKey !== undefined &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PrismaErrorCode.UNIQUE_CONSTRAINT
    );
  }

  async createRecord(
    unitOfWork: LedgerUnitOfWork,
    context: LedgerPostingContext,
  ): Promise<void> {
    if (!context.command.idempotencyKey) return;
    // The unique record is created inside the money transaction, closing the
    // race between concurrent requests using the same key.
    await unitOfWork.createIdempotency({
      idempotencyKey: context.command.idempotencyKey,
      userId: context.userId,
      accountNumber: context.command.accountNumber,
      requestHash: context.requestHash,
      expiresAt: new Date(Date.now() + LEDGER_IDEMPOTENCY_RETENTION_MS),
    });
  }

  async completeRecord(
    unitOfWork: LedgerUnitOfWork,
    context: LedgerPostingContext,
    response: LedgerTransactionResponse,
  ): Promise<void> {
    if (!context.command.idempotencyKey) return;
    // Persist the exact response so later retries remain stable.
    await unitOfWork.completeIdempotency(
      context.userId,
      context.command.accountNumber,
      context.command.idempotencyKey,
      response,
    );
  }

  private resolvePrevious(
    context: LedgerPostingContext,
    previous: LedgerIdempotencyKey,
  ): LedgerTransactionResponse {
    if (previous.requestHash !== context.requestHash) {
      rejectLedgerOperation(
        this.logger,
        httpConstants.HTTP_STATUS_CONFLICT,
        ErrorCode.CONFLICT,
        'Idempotency key was reused for a different transaction',
        {
          accountNumber: context.command.accountNumber,
          idempotencyKey: context.command.idempotencyKey ?? 'missing',
          userId: context.command.userId,
        },
      );
    }
    if (previous.responsePayload) {
      return ledgerTransactionResponseSchema.parse(previous.responsePayload);
    }
    this.rejectStillProcessing(context);
  }

  private rejectStillProcessing(context: LedgerPostingContext): never {
    rejectLedgerOperation(
      this.logger,
      httpConstants.HTTP_STATUS_SERVICE_UNAVAILABLE,
      ErrorCode.SERVICE_UNAVAILABLE,
      'Idempotent transaction is still processing',
      {
        accountNumber: context.command.accountNumber,
        idempotencyKey: context.command.idempotencyKey ?? 'missing',
        userId: context.command.userId,
      },
    );
  }
}
