import fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerErrorHandler } from "../common/errors/error-handler.js";
import { AppError } from "../common/errors/AppError.js";
import { ErrorCode } from "../common/errors/error-codes.js";
import { LedgerService } from "../modules/ledger/ledger.service.js";
import { healthRoutes } from "../modules/health/health.routes.js";
import { verifyInternalServiceToken } from "../common/auth/internal-service-jwt.js";

export async function buildLedgerApp(options: {
  prisma: PrismaClient;
  internalSecret: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false });
  registerErrorHandler(app);
  const ledger = new LedgerService(options.prisma);

  app.addHook("preHandler", async (request) => {
    if (
      request.url.startsWith("/internal/") &&
      !verifyInternalServiceToken({
        token: request.headers.authorization,
        audience: "ledger-service",
        allowedIssuers: ["api", "account-reconciler"],
        secret: options.internalSecret
      })
    ) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, "Unauthorized");
    }
  });

  app.post("/internal/ledger/accounts", async (request, reply) => {
    const account = await ledger.createAccount(request.body as never);
    return reply.status(201).send({
      ...account,
      availableBalance: Number(account.availableBalance.toFixed(2))
    });
  });
  app.get(
    "/internal/ledger/accounts/:accountNumber/balance",
    async (request) => ({
      balance: await ledger.getBalance(
        (request.params as { accountNumber: string }).accountNumber
      )
    })
  );
  app.post("/internal/ledger/accounts/balances", async (request) => ({
    balances: await ledger.getBalances(
      (request.body as { accountNumbers: string[] }).accountNumbers
    )
  }));
  app.post(
    "/internal/ledger/accounts/:accountNumber/close",
    async (request, reply) => {
      await ledger.closeAccount(
        (request.params as { accountNumber: string }).accountNumber
      );
      return reply.status(204).send();
    }
  );
  app.post(
    "/internal/ledger/accounts/:accountNumber/transactions",
    async (request, reply) =>
      reply.status(201).send(await ledger.postTransaction(request.body as never))
  );
  app.get(
    "/internal/ledger/accounts/:accountNumber/transactions",
    async (request) => ({
      transactions: await ledger.listTransactions(
        (request.params as { accountNumber: string }).accountNumber
      )
    })
  );
  app.get(
    "/internal/ledger/accounts/:accountNumber/transactions/:transactionId",
    async (request) => {
      const params = request.params as {
        accountNumber: string;
        transactionId: string;
      };
      return ledger.getTransaction(params.accountNumber, params.transactionId);
    }
  );
  await app.register(healthRoutes(options.prisma));
  return app;
}
