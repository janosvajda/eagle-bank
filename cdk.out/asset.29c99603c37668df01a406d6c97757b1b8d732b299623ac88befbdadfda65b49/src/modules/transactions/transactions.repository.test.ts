import { describe, expect, it, vi } from "vitest";
import { TransactionsRepository } from "./transactions.repository.js";

describe("TransactionsRepository", () => {
  it("lists and fetches transactions within an account", async () => {
    const db = {
      transaction: {
        findMany: vi.fn().mockResolvedValue(["listed"]),
        findFirst: vi.fn().mockResolvedValue("found")
      }
    };
    const repository = new TransactionsRepository(db as never);

    await repository.listByAccount("account-id");
    expect(db.transaction.findMany).toHaveBeenCalledWith({
      where: { accountId: "account-id" },
      orderBy: { createdAt: "asc" }
    });
    await repository.findByIdAndAccount("tan-1", "account-id");
    expect(db.transaction.findFirst).toHaveBeenCalledWith({
      where: { id: "tan-1", accountId: "account-id" }
    });
  });
});
