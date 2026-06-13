import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/app.js";
import { authorization, tokenFor } from "../helpers/auth.js";
import { resetDatabase, testPrisma } from "../helpers/database.js";
import { createAccount, createUser, userPayload } from "../helpers/factories.js";

describe("users", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
  });

  it("creates a user and rejects missing fields", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/users",
      payload: userPayload
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty("password");
    expect(
      (
        await app.inject({ method: "POST", url: "/v1/users", payload: {} })
      ).statusCode
    ).toBe(400);
  });

  it("fetches and updates only the authenticated user", async () => {
    const own = await createUser();
    const other = await createUser({
      email: "other@example.com",
      phoneNumber: "+447700900002"
    });
    const headers = authorization(tokenFor(app, own.id));

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/users/${own.id}`,
          headers
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/users/${other.id}`,
          headers
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/users/usr-missing",
          headers
        })
      ).statusCode
    ).toBe(404);

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/users/${own.id}`,
      headers,
      payload: { name: "Updated User" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Updated User");
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/v1/users/${other.id}`,
          headers,
          payload: { name: "No" }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/users/usr-missing",
          headers,
          payload: { name: "No" }
        })
      ).statusCode
    ).toBe(404);
  });

  it("enforces user deletion rules", async () => {
    const own = await createUser();
    const other = await createUser({
      email: "other@example.com",
      phoneNumber: "+447700900002"
    });
    const headers = authorization(tokenFor(app, own.id));

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/users/${other.id}`,
          headers
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/users/usr-missing",
          headers
        })
      ).statusCode
    ).toBe(404);

    await createAccount(own.id);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/users/${own.id}`,
          headers
        })
      ).statusCode
    ).toBe(409);

    await testPrisma.ledgerAccount.updateMany({
      data: { status: "CLOSED" }
    });
    await testPrisma.bankAccount.updateMany({
      data: { status: "CLOSED", deletedAt: new Date() }
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/users/${own.id}`,
          headers
        })
      ).statusCode
    ).toBe(204);
  });
});
