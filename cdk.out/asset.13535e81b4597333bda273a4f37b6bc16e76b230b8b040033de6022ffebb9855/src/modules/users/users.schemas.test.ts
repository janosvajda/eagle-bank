import { describe, expect, it } from "vitest";
import {
  addressSchema,
  createUserSchema,
  updateUserSchema,
  userIdSchema,
  userParamsSchema
} from "./users.schemas.js";

const address = {
  line1: "1 Test Road",
  town: "London",
  county: "Greater London",
  postcode: "SW1A 1AA"
};

describe("user schemas", () => {
  it("validates IDs and route parameters", () => {
    expect(userIdSchema.parse("usr-abc123")).toBe("usr-abc123");
    expect(userParamsSchema.parse({ userId: "usr-abc123" })).toEqual({
      userId: "usr-abc123"
    });
    expect(() => userIdSchema.parse("abc123")).toThrow();
  });

  it("validates required and optional address lines", () => {
    expect(
      addressSchema.parse({ ...address, line2: "Flat 2", line3: "West Wing" })
    ).toMatchObject({ line2: "Flat 2", line3: "West Wing" });
    expect(() => addressSchema.parse({ ...address, line1: "" })).toThrow();
  });

  it("validates create-user constraints", () => {
    const input = {
      name: "Test User",
      address,
      phoneNumber: "+447700900001",
      email: "test@example.com",
      password: "Password123!"
    };
    expect(createUserSchema.parse(input)).toEqual(input);
    expect(() => createUserSchema.parse({ ...input, phoneNumber: "07700" })).toThrow();
    expect(() => createUserSchema.parse({ ...input, email: "bad" })).toThrow();
    expect(() => createUserSchema.parse({ ...input, password: "short" })).toThrow();
    expect(() => createUserSchema.parse({ ...input, extra: true })).toThrow();
  });

  it("requires at least one valid update field", () => {
    expect(updateUserSchema.parse({ name: "Updated" })).toEqual({
      name: "Updated"
    });
    expect(updateUserSchema.parse({ address })).toEqual({ address });
    expect(() => updateUserSchema.parse({})).toThrow();
    expect(() => updateUserSchema.parse({ unknown: true })).toThrow();
  });
});
