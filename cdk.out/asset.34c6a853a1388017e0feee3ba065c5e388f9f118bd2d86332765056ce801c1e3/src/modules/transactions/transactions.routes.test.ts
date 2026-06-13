import fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it, vi } from "vitest";
import { transactionsRoutes } from "./transactions.routes.js";
import type { TransactionsService } from "./transactions.service.js";

describe("transactionsRoutes", () => {
  it("delegates transaction creation, listing, and fetching", async () => {
    const service = {
      create: vi.fn().mockResolvedValue({ id: "tan-abc123" }),
      list: vi.fn().mockResolvedValue({ transactions: [] }),
      get: vi.fn().mockResolvedValue({ id: "tan-abc123" })
    };
    const app = fastify();
    await app.register(fastifyJwt, {
      secret: "test-secret-that-is-at-least-32-characters"
    });
    app.decorate("authSessions", {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue({
        tokenId: "token-id",
        revokedAt: null,
        expiresAtEpoch: 9999999999
      })
    });
    await app.register(
      transactionsRoutes(service as unknown as TransactionsService)
    );
    const headers = {
      authorization: `Bearer ${app.jwt.sign({
        sub: "usr-owner",
        sid: "session-id",
        jti: "token-id"
      })}`
    };
    const payload = {
      amount: 10,
      currency: "GBP",
      type: "deposit"
    };

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/accounts/01234567/transactions",
          headers,
          payload
        })
      ).statusCode
    ).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      "01234567",
      "usr-owner",
      payload,
      undefined
    );

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01234567/transactions",
          headers
        })
      ).statusCode
    ).toBe(200);
    expect(service.list).toHaveBeenCalledWith("01234567", "usr-owner");

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01234567/transactions/tan-abc123",
          headers
        })
      ).statusCode
    ).toBe(200);
    expect(service.get).toHaveBeenCalledWith(
      "01234567",
      "tan-abc123",
      "usr-owner"
    );
    await app.close();
  });
});
