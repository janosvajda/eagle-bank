import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { constants as httpConstants } from 'node:http2';
import { HealthStatus } from './health.constants.js';

export function healthRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get('/health', async () => ({ status: HealthStatus.OK }));

    app.get('/ready', async (request, reply) => {
      try {
        // A minimal ORM read verifies connectivity, authentication, schema
        // availability, and Prisma query execution without embedding SQL.
        await prisma.user.findFirst({ select: { id: true } });
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
