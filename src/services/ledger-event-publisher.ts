import { loadLedgerEventPublisherConfig } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { LedgerEventPublisher } from '../modules/ledger/events/ledger-event-publisher.js';
import { LedgerOutboxRepository } from '../modules/ledger/persistence/ledger-outbox.repository.js';
import { SqsLedgerEventSink } from '../modules/ledger/events/ledger-event-sink.js';
import { createSqsClient } from '../common/aws/sqs-client.js';
import pino from 'pino';

const config = loadLedgerEventPublisherConfig();
const logger = pino({ name: 'ledger-event-publisher' });

const publisher = new LedgerEventPublisher(
  new LedgerOutboxRepository(prisma),
  new SqsLedgerEventSink(
    createSqsClient({
      environment: config.NODE_ENV,
      region: config.AWS_REGION,
      ...(config.SQS_ENDPOINT ? { endpoint: config.SQS_ENDPOINT } : {}),
      ...(config.AWS_ACCESS_KEY_ID
        ? { accessKeyId: config.AWS_ACCESS_KEY_ID }
        : {}),
      ...(config.AWS_SECRET_ACCESS_KEY
        ? { secretAccessKey: config.AWS_SECRET_ACCESS_KEY }
        : {}),
    }),
    config.SQS_LEDGER_EVENTS_QUEUE_URL,
  ),
  {
    batchSize: config.LEDGER_EVENT_PUBLISHER_BATCH_SIZE,
    maxAttempts: config.LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS,
    leaseMs: config.LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS,
    backoffBaseMs: config.LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS,
    backoffMaxMs: config.LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS,
  },
  logger,
);

let stopping = false;
const stop = (): void => {
  // Let the current batch finish, then leave the loop and disconnect Prisma.
  // This avoids abandoning a claimed event halfway through a database update.
  logger.info('Ledger event publisher shutdown requested');
  stopping = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

while (!stopping) {
  try {
    const publishedEventCount = await publisher.publishBatch();
    if (publishedEventCount > 0) {
      logger.info({ publishedEventCount }, 'Ledger event batch completed');
    }
  } catch (error) {
    // A batch-level failure must not terminate the long-running publisher.
    // Individual event failures are handled by the publisher retry state.
    logger.error({ err: error }, 'Ledger event batch failed');
  }
  await new Promise((resolve) =>
    setTimeout(resolve, config.LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS),
  );
}
logger.info('Ledger event publisher stopped');
await prisma.$disconnect();
