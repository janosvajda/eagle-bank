import fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import { describe, expect, it, vi } from "vitest";
import { usersRoutes } from "./users.routes.js";
import type { UsersService } from "./users.service.js";

const createPayload = {
  name: "Test User",
  address: {
    line1: "1 Test Road",
    town: "London",
    county: "Greater London",
    postcode: "SW1A 1AA"
  },
  phoneNumber: "+447700900001",
  email: "test@example.com",
  password: "Password123!"
};

describe("usersRoutes", () => {
  it("delegates create, get, update, and delete operations", async () => {
    const service = {
      create: vi.fn().mockResolvedValue({ id: "usr-owner" }),
      get: vi.fn().mockResolvedValue({ id: "usr-owner" }),
      update: vi.fn().mockResolvedValue({ id: "usr-owner", name: "Updated" }),
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
        expiresAtEpoch: 9999999999
      })
    });
    await app.register(usersRoutes(service as unknown as UsersService));
    const token = app.jwt.sign({
      sub: "usr-owner",
      sid: "session-id",
      jti: "token-id"
    });
    const headers = { authorization: `Bearer ${token}` };

    const created = await app.inject({
      method: "POST",
      url: "/v1/users",
      payload: createPayload
    });
    expect(created.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(createPayload);

    const fetched = await app.inject({
      method: "GET",
      url: "/v1/users/usr-owner",
      headers
    });
    expect(fetched.statusCode).toBe(200);
    expect(service.get).toHaveBeenCalledWith("usr-owner", "usr-owner");

    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/users/usr-owner",
      headers,
      payload: { name: "Updated" }
    });
    expect(updated.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith("usr-owner", "usr-owner", {
      name: "Updated"
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/users/usr-owner",
      headers
    });
    expect(deleted.statusCode).toBe(204);
    expect(service.delete).toHaveBeenCalledWith("usr-owner", "usr-owner");
    await app.close();
  });
});
