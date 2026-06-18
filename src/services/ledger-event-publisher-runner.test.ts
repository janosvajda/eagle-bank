import type pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerEventPublisher } from '../modules/ledger/events/ledger-event-publisher.js';
import { LedgerEventPublisherRunner } from './ledger-event-publisher-runner.js';

const POLL_INTERVAL_MS = 1000;

function publisher(
  publishBatch: () => Promise<number>,
): LedgerEventPublisher {
  return { publishBatch } as unknown as LedgerEventPublisher;
}

function logger(): pino.Logger {
  return {
    error: vi.fn(),
    info: vi.fn(),
  } as unknown as pino.Logger;
}

describe('LedgerEventPublisherRunner', () => {
  it('publishes one batch, logs the count, then stops after the poll delay', async () => {
    const log = logger();
    const publishBatch = vi.fn().mockResolvedValue(2);
    const control: { runner?: LedgerEventPublisherRunner } = {};
    const pause = vi.fn().mockImplementation(async () => {
      control.runner?.stop();
    });
    const runner = new LedgerEventPublisherRunner(
      publisher(publishBatch),
      POLL_INTERVAL_MS,
      log,
      pause,
    );
    control.runner = runner;

    await runner.run();

    expect(publishBatch).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledWith(
      { publishedEventCount: 2 },
      'Ledger event batch completed',
    );
    expect(pause).toHaveBeenCalledWith(POLL_INTERVAL_MS);
  });

  it('logs batch failures and keeps the runner alive until stopped', async () => {
    const log = logger();
    const failure = new Error('SQS unavailable');
    const publishBatch = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(0);
    const control: { runner?: LedgerEventPublisherRunner } = {};
    const pause = vi.fn().mockImplementation(async () => {
      if (pause.mock.calls.length === 2) {
        control.runner?.stop();
      }
    });
    const runner = new LedgerEventPublisherRunner(
      publisher(publishBatch),
      POLL_INTERVAL_MS,
      log,
      pause,
    );
    control.runner = runner;

    await runner.run();

    expect(publishBatch).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledWith(
      { err: failure },
      'Ledger event batch failed',
    );
  });
});
