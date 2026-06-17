import { describe, expect, it, vi } from 'vitest';
import { LedgerEventPublisher } from './ledger-event-publisher.js';

const options = {
  batchSize: 10,
  maxAttempts: 3,
  leaseMs: 1000,
  backoffBaseMs: 10,
  backoffMaxMs: 100,
};

type OutboxEventFixture = {
  id: string;
  eventId: string;
  eventType: string;
  payload: object;
  attempts: number;
};

function setup(
  events: OutboxEventFixture[],
  publish = vi.fn().mockResolvedValue(undefined),
) {
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const outbox = {
    claimBatch: vi.fn().mockResolvedValue(events),
    markPublished: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
  return {
    outbox,
    publisher: new LedgerEventPublisher(
      outbox as never,
      { publish } as never,
      options,
      logger as never,
    ),
    logger,
  };
}

describe('LedgerEventPublisher', () => {
  it('publishes and marks claimed events', async () => {
    const event = {
      id: '1',
      eventId: 'evt-1',
      eventType: 'TransactionPosted',
      payload: { id: 1 },
      attempts: 1,
    };
    const { outbox, logger, publisher } = setup([event]);
    await expect(publisher.publishBatch()).resolves.toBe(1);
    expect(outbox.markPublished).toHaveBeenCalledWith('1', expect.any(Date));
    expect(logger.info).toHaveBeenCalledWith(
      { claimedEventCount: 1 },
      'Ledger outbox events claimed',
    );
    expect(logger.info).toHaveBeenCalledWith(
      { eventId: 'evt-1', eventType: 'TransactionPosted' },
      'Ledger event published',
    );
  });

  it('handles empty claims and retryable failures', async () => {
    const { logger: emptyLogger, publisher: empty } = setup([]);
    await expect(empty.publishBatch()).resolves.toBe(0);
    expect(emptyLogger.info).not.toHaveBeenCalled();
    const event = {
      id: '1',
      eventId: 'evt-1',
      eventType: 'Event',
      payload: {},
      attempts: 1,
    };
    const { outbox, logger, publisher } = setup(
      [event],
      vi.fn().mockRejectedValue(new Error('failed')),
    );
    await publisher.publishBatch();
    expect(outbox.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: '1',
        errorMessage: 'failed',
        status: 'FAILED',
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 1,
        eventId: 'evt-1',
        eventType: 'Event',
        nextStatus: 'FAILED',
        err: expect.any(Error),
      }),
      'Ledger event publish failed',
    );
  });

  it('dead-letters terminal non-Error failures', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const event = {
      id: '1',
      eventId: 'evt-1',
      eventType: 'Event',
      payload: {},
      attempts: 3,
    };
    const { outbox, logger, publisher } = setup(
      [event],
      vi.fn().mockRejectedValue('failed'),
    );
    await publisher.publishBatch();
    expect(outbox.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: '1', status: 'DEAD' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 3,
        eventId: 'evt-1',
        eventType: 'Event',
        nextStatus: 'DEAD',
        err: 'failed',
      }),
      'Ledger event dead-lettered',
    );
  });
});
