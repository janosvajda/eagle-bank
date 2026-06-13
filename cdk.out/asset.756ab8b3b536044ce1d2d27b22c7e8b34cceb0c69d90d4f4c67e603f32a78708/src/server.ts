import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { prisma } from "./db/prisma.js";

const config = loadConfig();
const app = await buildApp({ prisma, config, logger: true });

const shutdown = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exit(1);
}
