import { randomUUID } from "node:crypto";
import type { LedgerOutboxEvent, PrismaClient } from "@prisma/client";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export interface LedgerEventPublisherOptions {
  queueUrl: string;
  batchSize: number;
  maxAttempts: number;
  leaseMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

export class LedgerEventPublisher {
  constructor(
    private readonly db: PrismaClient,
    private readonly sqs: SQSClient,
    private readonly options: LedgerEventPublisherOptions
  ) {}

  async publishBatch(): Promise<number> {
    const claimed = await this.claim();
    for (const event of claimed) {
      try {
        await this.sqs.send(
          new SendMessageCommand({
            QueueUrl: this.options.queueUrl,
            MessageBody: JSON.stringify(event.payload),
            MessageAttributes: {
              eventType: {
                DataType: "String",
                StringValue: event.eventType
              }
            }
          })
        );
        await this.db.ledgerOutboxEvent.update({
          where: { id: event.id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            processingLeaseExpiresAt: null,
            lastError: null
          }
        });
      } catch (error) {
        await this.markFailed(event, error);
      }
    }
    return claimed.length;
  }

  private claim(): Promise<LedgerOutboxEvent[]> {
    const leaseExpiry = new Date(Date.now() + this.options.leaseMs);
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "LedgerOutboxEvent"
        WHERE (
          ("status" IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= NOW())
          OR
          ("status" = 'PROCESSING' AND "processingLeaseExpiresAt" <= NOW())
        )
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.options.batchSize}
      `;
      if (rows.length === 0) return [];
      await tx.ledgerOutboxEvent.updateMany({
        where: { id: { in: rows.map(({ id }) => id) } },
        data: {
          status: "PROCESSING",
          processingLeaseExpiresAt: leaseExpiry,
          attempts: { increment: 1 }
        }
      });
      return tx.ledgerOutboxEvent.findMany({
        where: { id: { in: rows.map(({ id }) => id) } },
        orderBy: { createdAt: "asc" }
      });
    });
  }

  private async markFailed(
    event: LedgerOutboxEvent,
    error: unknown
  ): Promise<void> {
    const attempts = event.attempts;
    const dead = attempts >= this.options.maxAttempts;
    const exponential = this.options.backoffBaseMs * 2 ** Math.max(0, attempts - 1);
    const delay = Math.min(exponential, this.options.backoffMaxMs);
    const jitter = Math.floor(Math.random() * Math.max(1, delay / 4));
    await this.db.ledgerOutboxEvent.update({
      where: { id: event.id },
      data: {
        status: dead ? "DEAD" : "FAILED",
        nextAttemptAt: new Date(Date.now() + delay + jitter),
        processingLeaseExpiresAt: null,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : `Publish failure ${randomUUID()}`
      }
    });
  }
}

export function createSqsClient(options: {
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): SQSClient {
  return new SQSClient({
    region: options.region,
    ...(options.endpoint
      ? {
          endpoint: options.endpoint,
          credentials: {
            accessKeyId: options.accessKeyId ?? "test",
            secretAccessKey: options.secretAccessKey ?? "test"
          }
        }
      : {})
  });
}
