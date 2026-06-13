import fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it, vi } from "vitest";
import { accountsRoutes } from "./accounts.routes.js";
import type { AccountsService } from "./accounts.service.js";

describe("accountsRoutes", () => {
  it("delegates every authenticated account operation", async () => {
    const service = {
      create: vi.fn().mockResolvedValue({ accountNumber: "01234567" }),
      list: vi.fn().mockResolvedValue({ accounts: [] }),
      get: vi.fn().mockResolvedValue({ accountNumber: "01234567" }),
      update: vi
        .fn()
        .mockResolvedValue({ accountNumber: "01234567", name: "Updated" }),
      delete: vi.fn().mockResolvedValue(undefined)
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
        expiresAtEpoch: 9_999_999_999
      })
    });
    await app.register(accountsRoutes(service as unknown as AccountsService));
    const headers = {
      authorization: `Bearer ${app.jwt.sign({
        sub: "usr-owner",
        sid: "session-id",
        jti: "token-id"
      })}`
    };

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/accounts",
          headers,
          payload: { name: "Personal", accountType: "personal" }
        })
      ).statusCode
    ).toBe(201);
    expect(service.create).toHaveBeenCalledWith("usr-owner", {
      name: "Personal",
      accountType: "personal"
    });

    expect(
      (
        await app.inject({ method: "GET", url: "/v1/accounts", headers })
      ).statusCode
    ).toBe(200);
    expect(service.list).toHaveBeenCalledWith("usr-owner");

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01234567",
          headers
        })
      ).statusCode
    ).toBe(200);
    expect(service.get).toHaveBeenCalledWith("01234567", "usr-owner");

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/accounts/01234567",
          headers,
          payload: { name: "Updated" }
        })
      ).statusCode
    ).toBe(200);
    expect(service.update).toHaveBeenCalledWith("01234567", "usr-owner", {
      name: "Updated"
    });

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/accounts/01234567",
          headers
        })
      ).statusCode
    ).toBe(204);
    expect(service.delete).toHaveBeenCalledWith("01234567", "usr-owner");
    await app.close();
  });
});
