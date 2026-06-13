const enabled = process.env.LEDGER_ASYNC_COMMANDS_ENABLED === "true";
if (enabled) {
  throw new Error(
    "Asynchronous Ledger commands are modeled but intentionally not enabled"
  );
}

const interval = setInterval(() => undefined, 60_000);
const stop = (): void => {
  clearInterval(interval);
  process.exitCode = 0;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
