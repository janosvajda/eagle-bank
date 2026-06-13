import { describe, expect, it } from "vitest";
import {
  accountNumberSchema,
  accountParamsSchema,
  createAccountSchema,
  updateAccountSchema,
} from "./accounts.schemas.js";

describe("account schemas", () => {
  it("validates account numbers and route params", () => {
    expect(accountNumberSchema.parse("01234567")).toBe("01234567");
    expect(accountParamsSchema.parse({ accountNumber: "01234567" })).toEqual({
      accountNumber: "01234567",
    });
    expect(() => accountNumberSchema.parse("12345678")).toThrow();
  });

  it("accepts only personal account creation", () => {
    expect(
      createAccountSchema.parse({ name: "Personal", accountType: "personal" }),
    ).toEqual({ name: "Personal", accountType: "personal" });
    expect(() =>
      createAccountSchema.parse({ name: "Business", accountType: "business" }),
    ).toThrow();
    expect(() =>
      createAccountSchema.parse({
        name: "Personal",
        accountType: "personal",
        balance: 100,
      }),
    ).toThrow();
  });

  it("requires at least one valid update field", () => {
    expect(updateAccountSchema.parse({ name: "Updated" })).toEqual({
      name: "Updated",
    });
    expect(updateAccountSchema.parse({ accountType: "personal" })).toEqual({
      accountType: "personal",
    });
    expect(() => updateAccountSchema.parse({})).toThrow();
  });
});
