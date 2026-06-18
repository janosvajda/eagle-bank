import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '../../generated/prisma/client.js';

export interface DestroyableClient {
  destroy(): void;
}

export interface ServiceShutdownOptions {
  app?: FastifyInstance;
  prisma: PrismaClient;
  awsClients?: DestroyableClient[];
}

// Register one idempotent shutdown path per process. Docker/ECS can send
// multiple signals, so repeated calls must not close the same pools twice.
export function registerServiceShutdown(options: ServiceShutdownOptions): void {
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    await options.app?.close();
    for (const client of options.awsClients ?? []) {
      // AWS SDK v3 clients keep HTTP agents/sockets; destroy releases them.
      client.destroy();
    }
    await options.prisma.$disconnect();
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
