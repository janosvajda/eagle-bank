import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { UsersRepository } from "../users/users.repository.js";
import { AuthService } from "./auth.service.js";

describe("AuthService", () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash("Password123!");
  });

  function service(user: { id: string; passwordHash: string } | null) {
    const users = { findByEmail: vi.fn().mockResolvedValue(user) };
    const sign = vi.fn().mockReturnValue("signed-token");
    const app = { jwt: { sign } };
    return {
      users,
      sign,
      auth: new AuthService(
        users as unknown as UsersRepository,
        app as unknown as FastifyInstance,
        "1h"
      )
    };
  }

  it("signs a JWT for valid credentials", async () => {
    const { auth, sign } = service({ id: "usr-owner", passwordHash });
    await expect(
      auth.login({ email: "owner@example.com", password: "Password123!" })
    ).resolves.toEqual({ token: "signed-token" });
    expect(sign).toHaveBeenCalledWith({ sub: "usr-owner" }, { expiresIn: "1h" });
  });

  it("rejects a wrong password", async () => {
    const { auth, sign } = service({ id: "usr-owner", passwordHash });
    await expect(
      auth.login({ email: "owner@example.com", password: "wrong" })
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects a missing user", async () => {
    const { auth } = service(null);
    await expect(
      auth.login({ email: "missing@example.com", password: "Password123!" })
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
