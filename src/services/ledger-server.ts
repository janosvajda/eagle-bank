import { loadLedgerServiceConfig } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { buildLedgerApp } from './ledger-app.js';

const config = loadLedgerServiceConfig();
const app = await buildLedgerApp({
  prisma,
  internalSecret: config.LEDGER_SERVICE_JWT_SECRET,
  environment: config.NODE_ENV,
  logger: true,
});

await app.listen({
  host: '0.0.0.0',
  port: config.PORT,
});
