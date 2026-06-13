import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/app.js";
import { authorization, tokenFor } from "../helpers/auth.js";
import { resetDatabase, testPrisma } from "../helpers/database.js";
import { createAccount, createUser } from "../helpers/factories.js";

describe("transactions", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
  });

  it("deposits and withdraws atomically", async () => {
    const user = await createUser();
    await createAccount(user.id);
    const headers = authorization(tokenFor(app, user.id));

    const deposit = await app.inject({
      method: "POST",
      url: "/v1/accounts/01234567/transactions",
      headers,
      payload: { amount: 100.5, currency: "GBP", type: "deposit" },
    });
    expect(deposit.statusCode).toBe(201);
    expect(
      (
        await testPrisma.ledgerAccount.findUniqueOrThrow({
          where: { accountNumber: "01234567" },
        })
      ).availableBalance.toNumber(),
    ).toBe(100.5);

    const withdrawal = await app.inject({
      method: "POST",
      url: "/v1/accounts/01234567/transactions",
      headers,
      payload: { amount: 25.25, currency: "GBP", type: "withdrawal" },
    });
    expect(withdrawal.statusCode).toBe(201);
    expect(
      (
        await testPrisma.ledgerAccount.findUniqueOrThrow({
          where: { accountNumber: "01234567" },
        })
      ).availableBalance.toNumber(),
    ).toBe(75.25);
  });

  it("does not mutate state when funds are insufficient", async () => {
    const user = await createUser();
    const account = await createAccount(user.id);
    const response = await app.inject({
      method: "POST",
      url: "/v1/accounts/01234567/transactions",
      headers: authorization(tokenFor(app, user.id)),
      payload: { amount: 1, currency: "GBP", type: "withdrawal" },
    });
    expect(response.statusCode).toBe(422);
    expect(
      await testPrisma.ledgerTransaction.count({
        where: { accountId: account.id },
      }),
    ).toBe(0);
    expect(
      (
        await testPrisma.ledgerAccount.findUniqueOrThrow({
          where: { accountId: account.id },
        })
      ).availableBalance.toNumber(),
    ).toBe(0);
  });

  it("validates input and account ownership", async () => {
    const own = await createUser();
    const other = await createUser({
      email: "other@example.com",
      phoneNumber: "+447700900002",
    });
    await createAccount(other.id);
    const headers = authorization(tokenFor(app, own.id));

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/accounts/01234567/transactions",
          headers,
          payload: { currency: "GBP", type: "deposit" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/accounts/01234567/transactions",
          headers,
          payload: { amount: 1, currency: "GBP", type: "deposit" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/accounts/01999999/transactions",
          headers,
          payload: { amount: 1, currency: "GBP", type: "deposit" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("lists and fetches transactions with account scoping", async () => {
    const own = await createUser();
    const other = await createUser({
      email: "other@example.com",
      phoneNumber: "+447700900002",
    });
    await createAccount(own.id, "01111111");
    await createAccount(other.id, "01222222");
    const ownHeaders = authorization(tokenFor(app, own.id));
    const create = await app.inject({
      method: "POST",
      url: "/v1/accounts/01111111/transactions",
      headers: ownHeaders,
      payload: { amount: 10, currency: "GBP", type: "deposit" },
    });
    const transactionId = create.json().id as string;

    const list = await app.inject({
      method: "GET",
      url: "/v1/accounts/01111111/transactions",
      headers: ownHeaders,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().transactions).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01222222/transactions",
          headers: ownHeaders,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01999999/transactions",
          headers: ownHeaders,
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/accounts/01111111/transactions/${transactionId}`,
          headers: ownHeaders,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/accounts/01222222/transactions/${transactionId}`,
          headers: ownHeaders,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/accounts/01999999/transactions/${transactionId}`,
          headers: ownHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01111111/transactions/tan-missing",
          headers: ownHeaders,
        })
      ).statusCode,
    ).toBe(404);

    const otherHeaders = authorization(tokenFor(app, other.id));
    const otherTransaction = await app.inject({
      method: "POST",
      url: "/v1/accounts/01222222/transactions",
      headers: otherHeaders,
      payload: { amount: 2, currency: "GBP", type: "deposit" },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/accounts/01111111/transactions/${otherTransaction.json().id}`,
          headers: ownHeaders,
        })
      ).statusCode,
    ).toBe(404);
  });
});
