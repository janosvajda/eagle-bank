import { describe, expect, it, vi } from "vitest";
import {
  LedgerEventPublisher,
  createSqsClient
} from "./ledger-event-publisher.js";

const options = {
  queueUrl: "http://queue",
  batchSize: 10,
  maxAttempts: 3,
  leaseMs: 1000,
  backoffBaseMs: 10,
  backoffMaxMs: 100
};

function setup(events: any[], send = vi.fn().mockResolvedValue({})) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(events.map(({ id }) => ({ id }))),
    ledgerOutboxEvent: {
      updateMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue(events)
    }
  };
  const db = {
    $transaction: vi.fn((callback) => callback(tx)),
    ledgerOutboxEvent: { update: vi.fn() }
  };
  return {
    db,
    publisher: new LedgerEventPublisher(db as never, { send } as never, options)
  };
}

describe("LedgerEventPublisher", () => {
  it("publishes and marks claimed events", async () => {
    const event = { id: "1", eventType: "TransactionPosted", payload: { id: 1 }, attempts: 1 };
    const { db, publisher } = setup([event]);
    await expect(publisher.publishBatch()).resolves.toBe(1);
    expect(db.ledgerOutboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED" }) })
    );
  });

  it("handles empty claims and retryable failures", async () => {
    const { publisher: empty } = setup([]);
    await expect(empty.publishBatch()).resolves.toBe(0);
    const event = { id: "1", eventType: "Event", payload: {}, attempts: 1 };
    const { db, publisher } = setup([event], vi.fn().mockRejectedValue(new Error("failed")));
    await publisher.publishBatch();
    expect(db.ledgerOutboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", lastError: "failed" }) })
    );
  });

  it("dead-letters terminal non-Error failures and creates clients", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const event = { id: "1", eventType: "Event", payload: {}, attempts: 3 };
    const { db, publisher } = setup([event], vi.fn().mockRejectedValue("failed"));
    await publisher.publishBatch();
    expect(db.ledgerOutboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DEAD" }) })
    );
    expect(createSqsClient({ region: "eu-west-2" })).toBeDefined();
    expect(createSqsClient({ region: "eu-west-2", endpoint: "http://localhost:4566" })).toBeDefined();
  });
});
