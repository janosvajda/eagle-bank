import { loadConfig } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import {
  createSqsClient,
  LedgerEventPublisher
} from "../modules/ledger/ledger-event-publisher.js";

const config = loadConfig();
const pollInterval = Number(
  process.env.LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS ?? 1000
);
const queueUrl = process.env.SQS_LEDGER_EVENTS_QUEUE_URL;
if (!queueUrl) throw new Error("SQS_LEDGER_EVENTS_QUEUE_URL is required");

const publisher = new LedgerEventPublisher(
  prisma,
  createSqsClient({
    region: config.AWS_REGION,
    endpoint: process.env.SQS_ENDPOINT || undefined,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY
  }),
  {
    queueUrl,
    batchSize: Number(process.env.LEDGER_EVENT_PUBLISHER_BATCH_SIZE ?? 10),
    maxAttempts: Number(process.env.LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS ?? 5),
    leaseMs: Number(
      process.env.LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS ?? 30_000
    ),
    backoffBaseMs: Number(
      process.env.LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS ?? 1000
    ),
    backoffMaxMs: Number(
      process.env.LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS ?? 60_000
    )
  }
);

let stopping = false;
const stop = (): void => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

while (!stopping) {
  try {
    await publisher.publishBatch();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", error, service: "ledger-event-publisher" }));
  }
  await new Promise((resolve) => setTimeout(resolve, pollInterval));
}
await prisma.$disconnect();
