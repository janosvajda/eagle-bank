import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/app.js";
import { authorization, tokenFor } from "../helpers/auth.js";
import { resetDatabase, testPrisma } from "../helpers/database.js";
import { createAccount, createUser } from "../helpers/factories.js";

describe("accounts", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
  });

  it("creates an account and validates required fields", async () => {
    const user = await createUser();
    const headers = authorization(tokenFor(app, user.id));
    const response = await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers,
      payload: { name: "My Account", accountType: "personal" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().accountNumber).toMatch(/^01\d{6}$/);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/accounts",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });

  it("lists only the authenticated user's accounts", async () => {
    const own = await createUser();
    const other = await createUser({
      email: "other@example.com",
      phoneNumber: "+447700900002",
    });
    await createAccount(own.id, "01111111");
    await createAccount(other.id, "01222222");

    const response = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: authorization(tokenFor(app, own.id)),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accounts).toHaveLength(1);
    expect(response.json().accounts[0].accountNumber).toBe("01111111");
  });

  it("fetches and updates only owned accounts", async () => {
    const own = await createUser();
    const other = await createUser({
      email: "other@example.com",
      phoneNumber: "+447700900002",
    });
    await createAccount(own.id, "01111111");
    await createAccount(other.id, "01222222");
    const headers = authorization(tokenFor(app, own.id));

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01111111",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01222222",
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/accounts/01999999",
          headers,
        })
      ).statusCode,
    ).toBe(404);

    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/accounts/01111111",
      headers,
      payload: { name: "Updated" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("Updated");
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/accounts/01222222",
          headers,
          payload: { name: "No" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/accounts/01999999",
          headers,
          payload: { name: "No" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("deletes only owned existing accounts", async () => {
    const own = await createUser();
    const other = await createUser({
      email: "other@example.com",
      phoneNumber: "+447700900002",
    });
    await createAccount(own.id, "01111111");
    await createAccount(other.id, "01222222");
    const headers = authorization(tokenFor(app, own.id));

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/accounts/01222222",
          headers,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/accounts/01999999",
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/accounts/01111111",
          headers,
        })
      ).statusCode,
    ).toBe(204);
  });
});
