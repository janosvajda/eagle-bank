import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { authRoutes } from "./auth.routes.js";
import type { AuthService } from "./auth.service.js";

describe("authRoutes", () => {
  it("validates and delegates login", async () => {
    const login = vi.fn().mockResolvedValue({ token: "jwt" });
    const app = fastify();
    await app.register(authRoutes({ login } as unknown as AuthService));

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "user@example.com", password: "Password123!" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ token: "jwt" });
    expect(login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "Password123!"
    });
    await app.close();
  });
});
