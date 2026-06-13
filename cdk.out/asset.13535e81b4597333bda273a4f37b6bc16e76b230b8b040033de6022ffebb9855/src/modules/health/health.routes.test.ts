import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { healthRoutes } from "./health.routes.js";

describe("healthRoutes", () => {
  it("reports process health", async () => {
    const app = fastify();
    await app.register(healthRoutes({} as never));
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it.each([
    ["ready", vi.fn().mockResolvedValue([{ "?column?": 1 }]), 200],
    ["not_ready", vi.fn().mockRejectedValue(new Error("down")), 503]
  ])("reports %s dependency state", async (status, queryRaw, code) => {
    const app = fastify();
    await app.register(healthRoutes({ $queryRaw: queryRaw } as never));
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(code);
    expect(response.json()).toEqual({ status });
    await app.close();
  });
});
