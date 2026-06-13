import { loadConfig } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { buildLedgerApp } from "./ledger-app.js";

const config = loadConfig();
const app = await buildLedgerApp({
  prisma,
  internalSecret:
    process.env.INTERNAL_SERVICE_JWT_SECRET ?? config.JWT_SECRET,
  logger: true
});

await app.listen({
  host: "0.0.0.0",
  port: Number(process.env.LEDGER_SERVICE_PORT ?? config.PORT)
});
