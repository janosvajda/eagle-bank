import { describe, expect, it, vi } from "vitest";
import { authenticate } from "./authenticate.js";

describe("authenticate", () => {
  it("allows a valid JWT", async () => {
    const jwtVerify = vi.fn().mockResolvedValue(undefined);
    await expect(
      authenticate({ jwtVerify } as never, {} as never)
    ).resolves.toBeUndefined();
    expect(jwtVerify).toHaveBeenCalledOnce();
  });

  it("maps JWT verification failures to 401", async () => {
    const jwtVerify = vi.fn().mockRejectedValue(new Error("invalid"));
    await expect(authenticate({ jwtVerify } as never, {} as never)).rejects.toMatchObject({
      statusCode: 401,
      message: "Access token is missing or invalid"
    });
  });
});
