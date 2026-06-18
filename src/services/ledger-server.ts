import { loadLedgerServiceConfig } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { buildLedgerApp } from './ledger-app.js';
import { registerServiceShutdown } from './service-shutdown.js';

const config = loadLedgerServiceConfig();
const app = await buildLedgerApp({
  prisma,
  internalSecret: config.LEDGER_SERVICE_JWT_SECRET,
  environment: config.NODE_ENV,
  logger: true,
});

// Ledger owns a Fastify server and the shared Prisma client in this process.
// Registering shutdown here keeps database pool cleanup out of request code.
registerServiceShutdown({ app, prisma });

await app.listen({
  host: '0.0.0.0',
  port: config.PORT,
});
