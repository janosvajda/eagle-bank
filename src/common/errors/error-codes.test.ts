import { describe, expect, it } from "vitest";
import { ErrorCode } from "./error-codes.js";

describe("ErrorCode", () => {
  it("defines the complete public error-code set", () => {
    expect(ErrorCode).toEqual({
      BAD_REQUEST: "BAD_REQUEST",
      UNAUTHORIZED: "UNAUTHORIZED",
      FORBIDDEN: "FORBIDDEN",
      NOT_FOUND: "NOT_FOUND",
      CONFLICT: "CONFLICT",
      INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
      INTERNAL_ERROR: "INTERNAL_ERROR"
    });
  });
});
