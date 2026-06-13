import { afterEach, describe, expect, it, vi } from "vitest";

const config = {
  NODE_ENV: "test",
  PORT: 3000,
  DATABASE_URL: "postgresql://localhost/test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  JWT_EXPIRES_IN: "1h",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("./app.js");
  vi.doUnmock("./config/env.js");
  vi.doUnmock("./db/prisma.js");
});

describe("server entry point", () => {
  it("starts and registers graceful shutdown handlers", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const handlers = new Map<string, () => void>();
    vi.spyOn(process, "on").mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      handlers.set(event, handler);
      return process;
    }) as never);
    vi.doMock("./app.js", () => ({
      buildApp: vi.fn().mockResolvedValue({
        close,
        listen,
        log: { error: vi.fn() },
      }),
    }));
    vi.doMock("./config/env.js", () => ({ loadConfig: () => config }));
    vi.doMock("./db/prisma.js", () => ({
      prisma: { $disconnect: disconnect },
    }));

    await import("./server.js");

    expect(listen).toHaveBeenCalledWith({ host: "0.0.0.0", port: 3000 });
    expect(handlers.has("SIGINT")).toBe(true);
    expect(handlers.has("SIGTERM")).toBe(true);
    handlers.get("SIGINT")?.();
    handlers.get("SIGTERM")?.();
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(2);
      expect(disconnect).toHaveBeenCalledTimes(2);
    });
  });

  it("logs startup failure, shuts down, and exits", async () => {
    const error = new Error("bind failed");
    const close = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const logError = vi.fn();
    vi.spyOn(process, "on").mockReturnValue(process);
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.doMock("./app.js", () => ({
      buildApp: vi.fn().mockResolvedValue({
        close,
        listen: vi.fn().mockRejectedValue(error),
        log: { error: logError },
      }),
    }));
    vi.doMock("./config/env.js", () => ({ loadConfig: () => config }));
    vi.doMock("./db/prisma.js", () => ({
      prisma: { $disconnect: disconnect },
    }));

    await import("./server.js");

    expect(logError).toHaveBeenCalledWith(error);
    expect(close).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
