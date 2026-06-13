import { loadConfig } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import {
  createSqsClient,
  LedgerEventPublisher,
} from "../modules/ledger/ledger-event-publisher.js";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_PROCESSING_LEASE_MS = 30000;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 60000;

const config = loadConfig();
const pollInterval = Number(
  process.env.LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS ??
    DEFAULT_POLL_INTERVAL_MS,
);
const queueUrl = process.env.SQS_LEDGER_EVENTS_QUEUE_URL;
if (!queueUrl) throw new Error("SQS_LEDGER_EVENTS_QUEUE_URL is required");

const publisher = new LedgerEventPublisher(
  prisma,
  createSqsClient({
    region: config.AWS_REGION,
    endpoint: process.env.SQS_ENDPOINT || undefined,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  }),
  {
    queueUrl,
    batchSize: Number(
      process.env.LEDGER_EVENT_PUBLISHER_BATCH_SIZE ?? DEFAULT_BATCH_SIZE,
    ),
    maxAttempts: Number(
      process.env.LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS,
    ),
    leaseMs: Number(
      process.env.LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS ??
        DEFAULT_PROCESSING_LEASE_MS,
    ),
    backoffBaseMs: Number(
      process.env.LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS ??
        DEFAULT_BACKOFF_BASE_MS,
    ),
    backoffMaxMs: Number(
      process.env.LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS ??
        DEFAULT_BACKOFF_MAX_MS,
    ),
  },
);

let stopping = false;
const stop = (): void => {
  // Let the current batch finish, then leave the loop and disconnect Prisma.
  // This avoids abandoning a claimed event halfway through a database update.
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (!stopping) {
  try {
    await publisher.publishBatch();
  } catch (error) {
    // A batch-level failure must not terminate the long-running publisher.
    // Individual event failures are handled by the publisher retry state.
    console.error(
      JSON.stringify({
        level: "error",
        error,
        service: "ledger-event-publisher",
      }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, pollInterval));
}
await prisma.$disconnect();
