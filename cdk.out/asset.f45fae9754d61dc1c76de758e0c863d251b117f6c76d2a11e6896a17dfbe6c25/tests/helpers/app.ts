import { buildApp } from "../../src/app.js";
import { testPrisma } from "./database.js";

export async function createTestApp() {
  return buildApp({
    prisma: testPrisma,
    config: {
      NODE_ENV: "test",
      PORT: 3000,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      JWT_SECRET: "test-secret-that-is-at-least-32-characters",
      JWT_EXPIRES_IN: "1h"
    }
  });
}
