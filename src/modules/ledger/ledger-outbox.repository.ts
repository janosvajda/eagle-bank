import {
  OutboxStatus,
  Prisma,
  type LedgerOutboxEvent,
  type PrismaClient,
} from '@prisma/client';

export interface ClaimOutboxEventsOptions {
  batchSize: number;
  leaseExpiresAt: Date;
  now: Date;
  processingToken: string;
}

export interface MarkOutboxEventFailedOptions {
  eventId: string;
  errorMessage: string;
  nextAttemptAt: Date;
  status: typeof OutboxStatus.DEAD | typeof OutboxStatus.FAILED;
}

export class LedgerOutboxRepository {
  constructor(private readonly database: PrismaClient) {}

  async claimBatch(
    options: ClaimOutboxEventsOptions,
  ): Promise<LedgerOutboxEvent[]> {
    const claimable = {
      OR: [
        {
          status: {
            in: [OutboxStatus.PENDING, OutboxStatus.FAILED],
          },
          nextAttemptAt: { lte: options.now },
        },
        {
          status: OutboxStatus.PROCESSING,
          processingLeaseExpiresAt: { lte: options.now },
        },
      ],
    } satisfies Prisma.LedgerOutboxEventWhereInput;

    // Candidate selection is intentionally separate from claiming. The update
    // repeats the claim predicate, so only one publisher can transition a row
    // to its unique processing token when instances race for the same IDs.
    const candidates = await this.database.ledgerOutboxEvent.findMany({
      where: claimable,
      select: { id: true },
      orderBy: { createdAt: Prisma.SortOrder.asc },
      take: options.batchSize,
    });
    if (candidates.length === 0) {
      return [];
    }

    await this.database.ledgerOutboxEvent.updateMany({
      where: {
        id: { in: candidates.map(({ id }) => id) },
        ...claimable,
      },
      data: {
        status: OutboxStatus.PROCESSING,
        processingLeaseExpiresAt: options.leaseExpiresAt,
        processingToken: options.processingToken,
        attempts: { increment: 1 },
      },
    });

    return this.database.ledgerOutboxEvent.findMany({
      where: { processingToken: options.processingToken },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    });
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    await this.database.ledgerOutboxEvent.update({
      where: { id: eventId },
      data: {
        status: OutboxStatus.PUBLISHED,
        publishedAt,
        processingLeaseExpiresAt: null,
        processingToken: null,
        lastError: null,
      },
    });
  }

  async markFailed(options: MarkOutboxEventFailedOptions): Promise<void> {
    await this.database.ledgerOutboxEvent.update({
      where: { id: options.eventId },
      data: {
        status: options.status,
        nextAttemptAt: options.nextAttemptAt,
        processingLeaseExpiresAt: null,
        processingToken: null,
        lastError: options.errorMessage,
      },
    });
  }
}
