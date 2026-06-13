import { describe, expect, it } from "vitest";
import { loginSchema } from "./auth.schemas.js";

describe("loginSchema", () => {
  it("accepts email and password only", () => {
    const input = { email: "user@example.com", password: "Password123!" };
    expect(loginSchema.parse(input)).toEqual(input);
    expect(() => loginSchema.parse({ ...input, extra: true })).toThrow();
  });

  it("rejects malformed credentials", () => {
    expect(() => loginSchema.parse({ email: "bad", password: "x" })).toThrow();
    expect(() =>
      loginSchema.parse({ email: "user@example.com", password: "" }),
    ).toThrow();
  });
});
