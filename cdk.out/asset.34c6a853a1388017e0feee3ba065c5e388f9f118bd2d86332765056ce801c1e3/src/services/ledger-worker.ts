const enabled = process.env.LEDGER_ASYNC_COMMANDS_ENABLED === "true";
const LEDGER_WORKER_HEARTBEAT_INTERVAL_MS = 60000;

if (enabled) {
  throw new Error(
    "Asynchronous Ledger commands are modeled but intentionally not enabled",
  );
}

const interval = setInterval(
  () => undefined,
  LEDGER_WORKER_HEARTBEAT_INTERVAL_MS,
);
const stop = (): void => {
  clearInterval(interval);
  process.exitCode = 0;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
