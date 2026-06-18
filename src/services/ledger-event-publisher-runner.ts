import type pino from 'pino';
import type { LedgerEventPublisher } from '../modules/ledger/events/ledger-event-publisher.js';

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export class LedgerEventPublisherRunner {
  private stopping = false;

  constructor(
    private readonly publisher: LedgerEventPublisher,
    private readonly pollIntervalMs: number,
    private readonly logger: pino.Logger,
    private readonly pause: (durationMs: number) => Promise<void> = sleep,
  ) {}

  stop(): void {
    // Let the current batch finish, then leave the loop and disconnect Prisma.
    // This avoids abandoning a claimed event halfway through a database update.
    this.stopping = true;
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const publishedEventCount = await this.publisher.publishBatch();
        if (publishedEventCount > 0) {
          this.logger.info(
            { publishedEventCount },
            'Ledger event batch completed',
          );
        }
      } catch (error) {
        // A batch-level failure must not terminate the long-running publisher.
        // Individual event failures are handled by the publisher retry state.
        this.logger.error({ err: error }, 'Ledger event batch failed');
      }
      await this.pause(this.pollIntervalMs);
    }
  }
}
