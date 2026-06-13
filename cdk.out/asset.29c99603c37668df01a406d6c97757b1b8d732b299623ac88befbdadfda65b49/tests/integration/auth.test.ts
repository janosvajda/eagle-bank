import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/app.js";
import { resetDatabase, testPrisma } from "../helpers/database.js";
import { createUser } from "../helpers/factories.js";

describe("authentication", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
  });

  it("logs in with valid credentials", async () => {
    await createUser();
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "test@example.com", password: "Password123!" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accessToken: expect.any(String),
      tokenType: "Bearer",
      expiresIn: 3600
    });
  });

  it("rejects invalid credentials", async () => {
    await createUser();
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "test@example.com", password: "WrongPassword123!" }
    });
    expect(response.statusCode).toBe(401);
  });

  it.each([
    ["without a token", undefined],
    ["with an invalid token", "Bearer invalid"]
  ])("rejects a protected endpoint %s", async (_label, authorization) => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/accounts",
      headers: authorization ? { authorization } : {}
    });
    expect(response.statusCode).toBe(401);
  });
});
