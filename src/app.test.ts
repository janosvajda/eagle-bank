import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const config = {
  NODE_ENV: "test" as const,
  PORT: 3000,
  DATABASE_URL: "postgresql://localhost/test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  JWT_EXPIRES_IN: "1h",
};

describe("buildApp", () => {
  it.each([undefined, true])(
    "assembles every API route with logger=%s",
    async (logger) => {
      const app = await buildApp({
        prisma: {} as PrismaClient,
        config,
        ...(logger === undefined ? {} : { logger }),
      });

      expect(app.hasRoute({ method: "POST", url: "/v1/auth/login" })).toBe(
        true,
      );
      expect(app.hasRoute({ method: "POST", url: "/v1/users" })).toBe(true);
      expect(app.hasRoute({ method: "GET", url: "/v1/accounts" })).toBe(true);
      expect(
        app.hasRoute({
          method: "GET",
          url: "/v1/accounts/:accountNumber/transactions/:transactionId",
        }),
      ).toBe(true);
      await app.close();
    },
  );
});
