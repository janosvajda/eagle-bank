import { describe, expect, it } from "vitest";
import { AppError } from "./AppError.js";
import { ErrorCode } from "./error-codes.js";

describe("AppError", () => {
  it("retains HTTP and public error metadata", () => {
    const details = [{ field: "email", message: "Invalid", type: "format" }];
    const error = new AppError(
      400,
      ErrorCode.BAD_REQUEST,
      "Bad request",
      details,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ErrorCode.BAD_REQUEST);
    expect(error.message).toBe("Bad request");
    expect(error.details).toBe(details);
  });
});
