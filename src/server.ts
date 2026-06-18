import { buildApp } from './app.js';
import { loadApiConfig } from './config/env.js';
import { prisma } from './db/prisma.js';
import { registerServiceShutdown } from './services/service-shutdown.js';

const config = loadApiConfig();
const app = await buildApp({ prisma, config, logger: true });

registerServiceShutdown({ app, prisma });

try {
  await app.listen({ host: '0.0.0.0', port: config.PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  await prisma.$disconnect();
  process.exit(1);
}
