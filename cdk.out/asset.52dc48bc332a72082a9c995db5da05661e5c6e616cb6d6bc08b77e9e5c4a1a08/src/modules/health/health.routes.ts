import type { FastifyPluginAsync } from "fastify";
import type { PrismaClient } from "@prisma/client";

export function healthRoutes(prisma: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get("/health", async () => ({ status: "ok" as const }));

    app.get("/ready", async (_request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: "ready" as const };
      } catch {
        return reply.status(503).send({ status: "not_ready" as const });
      }
    });
  };
}
