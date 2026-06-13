import { Prisma, type Transaction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { mapTransaction } from "./transactions.mapper.js";

function transaction(reference: string | null): Transaction {
  return {
    id: "tan-abc123",
    amount: new Prisma.Decimal("10.50"),
    currency: "GBP",
    type: "deposit",
    reference,
    userId: "usr-owner",
    accountId: "00000000-0000-4000-8000-000000000001",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

describe("mapTransaction", () => {
  it("maps a transaction with a reference", () => {
    expect(mapTransaction(transaction("Salary"))).toEqual({
      id: "tan-abc123",
      amount: 10.5,
      currency: "GBP",
      type: "deposit",
      reference: "Salary",
      userId: "usr-owner",
      createdTimestamp: "2026-01-01T00:00:00.000Z"
    });
  });

  it("omits an absent reference", () => {
    expect(mapTransaction(transaction(null))).not.toHaveProperty("reference");
  });
});
