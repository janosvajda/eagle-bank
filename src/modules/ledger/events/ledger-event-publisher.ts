import { randomUUID } from 'node:crypto';
import {
  OutboxStatus,
  type LedgerOutboxEvent,
} from '../../../../generated/prisma/client.js';
import type { Logger } from 'pino';
import type { LedgerOutboxRepository } from '../persistence/ledger-outbox.repository.js';
import type { LedgerEventSink } from './ledger-event-sink.js';
import {
  LEDGER_BACKOFF_EXPONENTIAL_BASE,
  LEDGER_JITTER_DIVISOR,
  LEDGER_MAX_ERROR_MESSAGE_LENGTH,
  LEDGER_MINIMUM_JITTER_RANGE_MS,
} from '../domain/ledger.constants.js';

export interface LedgerEventPublisherOptions {
  batchSize: number;
  maxAttempts: number;
  leaseMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

export class LedgerEventPublisher {
  constructor(
    private readonly outbox: LedgerOutboxRepository,
    private readonly eventSink: LedgerEventSink,
    private readonly options: LedgerEventPublisherOptions,
    private readonly logger: Logger,
  ) {}

  async publishBatch(): Promise<number> {
    const claimed = await this.claim();
    if (claimed.length > 0) {
      this.logger.info(
        { claimedEventCount: claimed.length },
        'Ledger outbox events claimed',
      );
    }
    for (const event of claimed) {
      try {
        // Publishing happens after the claim transaction. If this process dies,
        // the processing lease eventually makes the event claimable again.
        await this.eventSink.publish(event);
        await this.outbox.markPublished(event.id, new Date());
        this.logger.info(
          { eventId: event.eventId, eventType: event.eventType },
          'Ledger event published',
        );
      } catch (error) {
        await this.markFailed(event, error);
      }
    }
    return claimed.length;
  }

  private claim(): Promise<LedgerOutboxEvent[]> {
    const now = new Date();
    return this.outbox.claimBatch({
      batchSize: this.options.batchSize,
      leaseExpiresAt: new Date(now.getTime() + this.options.leaseMs),
      now,
      processingToken: randomUUID(),
    });
  }

  private async markFailed(
    event: LedgerOutboxEvent,
    error: unknown,
  ): Promise<void> {
    const attempts = event.attempts;
    const dead = attempts >= this.options.maxAttempts;
    const exponential =
      this.options.backoffBaseMs *
      LEDGER_BACKOFF_EXPONENTIAL_BASE ** Math.max(0, attempts - 1);
    const delay = Math.min(exponential, this.options.backoffMaxMs);
    const jitter = Math.floor(
      Math.random() *
        Math.max(LEDGER_MINIMUM_JITTER_RANGE_MS, delay / LEDGER_JITTER_DIVISOR),
    );

    // Backoff reduces pressure during outages; jitter prevents synchronized
    // retries from multiple publisher instances.
    await this.outbox.markFailed({
      eventId: event.id,
      errorMessage:
        error instanceof Error
          ? error.message.slice(0, LEDGER_MAX_ERROR_MESSAGE_LENGTH)
          : `Publish failure ${randomUUID()}`,
      nextAttemptAt: new Date(Date.now() + delay + jitter),
      status: dead ? OutboxStatus.DEAD : OutboxStatus.FAILED,
    });
    const context = {
      attempts,
      eventId: event.eventId,
      eventType: event.eventType,
      nextStatus: dead ? OutboxStatus.DEAD : OutboxStatus.FAILED,
    };
    if (dead) {
      this.logger.error(
        { ...context, err: error },
        'Ledger event dead-lettered',
      );
    } else {
      this.logger.warn(
        { ...context, err: error },
        'Ledger event publish failed',
      );
    }
  }
}
