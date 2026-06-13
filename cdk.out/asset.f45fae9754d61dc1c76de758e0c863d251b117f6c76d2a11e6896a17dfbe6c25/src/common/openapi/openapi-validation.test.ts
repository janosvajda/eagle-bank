import { resolve } from "node:path";
import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandler } from "../errors/error-handler.js";
import { registerOpenApiValidation } from "./openapi-validation.js";

async function buildContractApp() {
  const app = fastify({ logger: false });
  registerErrorHandler(app);
  await registerOpenApiValidation(app, {
    definition: resolve(process.cwd(), "openapi.yaml")
  });
  return app;
}

describe("registerOpenApiValidation", () => {
  it("rejects a request that violates openapi.yaml", async () => {
    const app = await buildContractApp();
    app.post("/v1/users", async () => ({ unexpected: true }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/users",
      payload: { email: "not-an-email" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: "Invalid details supplied",
      details: expect.any(Array)
    });
    await app.close();
  });

  it("allows a contract-compliant health response", async () => {
    const app = await buildContractApp();
    app.get("/health", async () => ({ status: "ok" }));

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("converts an undocumented response shape into an internal error", async () => {
    const app = await buildContractApp();
    app.get("/health", async () => ({ status: "wrong" }));

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ message: "An unexpected error occurred" });
    await app.close();
  });
});
