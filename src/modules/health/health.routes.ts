import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { constants as httpConstants } from 'node:http2';
import { HealthStatus } from './health.constants.js';

export function healthRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get('/health', async () => ({ status: HealthStatus.OK }));

    app.get('/ready', async (request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: HealthStatus.READY };
      } catch (error) {
        request.log.error({ err: error }, 'Readiness dependency check failed');
        return reply
          .status(httpConstants.HTTP_STATUS_SERVICE_UNAVAILABLE)
          .send({ status: HealthStatus.NOT_READY });
      }
    });
  };
}
