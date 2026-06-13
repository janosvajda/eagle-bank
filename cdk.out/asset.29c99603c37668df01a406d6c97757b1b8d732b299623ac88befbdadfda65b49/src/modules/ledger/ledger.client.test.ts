import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerHttpClient } from "./ledger.client.js";

describe("LedgerHttpClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not declare JSON content for a bodyless close command", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(undefined, { status: 204 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await new LedgerHttpClient(
      "http://ledger",
      "internal-secret-at-least-32-characters"
    ).closeAccount("01000001");
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["content-type"]).toBeUndefined();
    expect(headers.authorization).toMatch(/^Bearer /);
  });
});
