import { Prisma, type BankAccount } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { mapAccount } from "./accounts.mapper.js";

describe("mapAccount", () => {
  it("maps the persistence model to the OpenAPI response", () => {
    const account: BankAccount = {
      id: "00000000-0000-4000-8000-000000000001",
      accountNumber: "01234567",
      sortCode: "10-10-10",
      name: "Personal",
      accountType: "personal",
      balance: new Prisma.Decimal("10.50"),
      currency: "GBP",
      userId: "usr-owner",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z")
    };

    expect(mapAccount(account)).toEqual({
      accountNumber: "01234567",
      sortCode: "10-10-10",
      name: "Personal",
      accountType: "personal",
      balance: 10.5,
      currency: "GBP",
      createdTimestamp: "2026-01-01T00:00:00.000Z",
      updatedTimestamp: "2026-01-02T00:00:00.000Z"
    });
  });
});
