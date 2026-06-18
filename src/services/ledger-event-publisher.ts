import { loadLedgerEventPublisherConfig } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { LedgerEventPublisher } from '../modules/ledger/events/ledger-event-publisher.js';
import { LedgerOutboxRepository } from '../modules/ledger/persistence/ledger-outbox.repository.js';
import { SqsLedgerEventSink } from '../modules/ledger/events/ledger-event-sink.js';
import { createSqsClient } from '../common/aws/sqs-client.js';
import pino from 'pino';
import { LedgerEventPublisherRunner } from './ledger-event-publisher-runner.js';

const config = loadLedgerEventPublisherConfig();
const logger = pino({ name: 'ledger-event-publisher' });
const sqsClient = createSqsClient({
  environment: config.NODE_ENV,
  region: config.AWS_REGION,
  ...(config.SQS_ENDPOINT ? { endpoint: config.SQS_ENDPOINT } : {}),
  ...(config.AWS_ACCESS_KEY_ID
    ? { accessKeyId: config.AWS_ACCESS_KEY_ID }
    : {}),
  ...(config.AWS_SECRET_ACCESS_KEY
    ? { secretAccessKey: config.AWS_SECRET_ACCESS_KEY }
    : {}),
});

const publisher = new LedgerEventPublisher(
  new LedgerOutboxRepository(prisma),
  new SqsLedgerEventSink(sqsClient, config.SQS_LEDGER_EVENTS_QUEUE_URL),
  {
    batchSize: config.LEDGER_EVENT_PUBLISHER_BATCH_SIZE,
    maxAttempts: config.LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS,
    leaseMs: config.LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS,
    backoffBaseMs: config.LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS,
    backoffMaxMs: config.LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS,
  },
  logger,
);

const stop = (): void => {
  logger.info('Ledger event publisher shutdown requested');
  runner.stop();
};

const runner = new LedgerEventPublisherRunner(
  publisher,
  config.LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS,
  logger,
);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

await runner.run();
logger.info('Ledger event publisher stopped');
sqsClient.destroy();
await prisma.$disconnect();
