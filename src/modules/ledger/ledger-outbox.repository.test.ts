import { describe, expect, it, vi } from 'vitest';
import { LedgerOutboxRepository } from './ledger-outbox.repository.js';

function setup(candidateIds: string[]) {
  const events = candidateIds.map((id) => ({ id }));
  const ledgerOutboxEvent = {
    findMany: vi
      .fn()
      .mockResolvedValueOnce(events)
      .mockResolvedValueOnce(events),
    updateMany: vi.fn().mockResolvedValue({ count: candidateIds.length }),
    update: vi.fn().mockResolvedValue({}),
  };
  return {
    ledgerOutboxEvent,
    repository: new LedgerOutboxRepository({
      ledgerOutboxEvent,
    } as never),
  };
}

describe('LedgerOutboxRepository', () => {
  it('returns immediately when no claimable events exist', async () => {
    const { ledgerOutboxEvent, repository } = setup([]);
    await expect(
      repository.claimBatch({
        batchSize: 10,
        leaseExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
        now: new Date('2026-01-01T00:00:00.000Z'),
        processingToken: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toEqual([]);
    expect(ledgerOutboxEvent.updateMany).not.toHaveBeenCalled();
  });

  it('claims candidates with a unique processing token', async () => {
    const { ledgerOutboxEvent, repository } = setup(['event-1']);
    const processingToken = '00000000-0000-4000-8000-000000000001';
    await expect(
      repository.claimBatch({
        batchSize: 10,
        leaseExpiresAt: new Date('2026-01-01T00:01:00.000Z'),
        now: new Date('2026-01-01T00:00:00.000Z'),
        processingToken,
      }),
    ).resolves.toEqual([{ id: 'event-1' }]);
    expect(ledgerOutboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processingToken }),
      }),
    );
  });

  it('marks published and failed events while releasing claims', async () => {
    const { ledgerOutboxEvent, repository } = setup([]);
    const publishedAt = new Date('2026-01-01T00:00:00.000Z');
    await repository.markPublished('event-1', publishedAt);
    await repository.markFailed({
      eventId: 'event-2',
      errorMessage: 'SQS unavailable',
      nextAttemptAt: new Date('2026-01-01T00:01:00.000Z'),
      status: 'FAILED',
    });

    expect(ledgerOutboxEvent.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          processingToken: null,
          publishedAt,
        }),
      }),
    );
    expect(ledgerOutboxEvent.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: 'SQS unavailable',
          processingToken: null,
        }),
      }),
    );
  });
});
