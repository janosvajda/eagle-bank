import fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerErrorHandler } from "../common/errors/error-handler.js";
import { AppError } from "../common/errors/AppError.js";
import { ErrorCode } from "../common/errors/error-codes.js";
import { LedgerService } from "../modules/ledger/ledger.service.js";
import { healthRoutes } from "../modules/health/health.routes.js";
import { verifyInternalServiceToken } from "../common/auth/internal-service-jwt.js";
import type {
  LedgerAccountCommand,
  LedgerAccountResponse,
  LedgerTransactionResponse,
  PostLedgerTransactionCommand,
} from "../modules/ledger/ledger.contracts.js";
import {
  ledgerAccountCommandSchema,
  postLedgerTransactionCommandSchema,
} from "../modules/ledger/ledger.contracts.js";

interface AccountNumberParams {
  accountNumber: string;
}

interface TransactionParams extends AccountNumberParams {
  transactionId: string;
}

interface AccountNumbersRequest {
  accountNumbers: string[];
}

export async function buildLedgerApp(options: {
  prisma: PrismaClient;
  internalSecret: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false });
  registerErrorHandler(app);
  const ledger = new LedgerService(options.prisma);

  // Ledger has no public ALB route. The hook still authenticates every internal
  // request so private-network access alone is never treated as authorization.
  app.addHook("preHandler", async (request) => {
    if (
      request.url.startsWith("/internal/") &&
      !verifyInternalServiceToken({
        token: request.headers.authorization,
        audience: "ledger-service",
        allowedIssuers: ["api", "account-reconciler"],
        secret: options.internalSecret,
      })
    ) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, "Unauthorized");
    }
  });

  app.post<{ Body: LedgerAccountCommand; Reply: LedgerAccountResponse }>(
    "/internal/ledger/accounts",
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await ledger.createAccount(
            ledgerAccountCommandSchema.parse(request.body),
          ),
        ),
  );
  app.get<{ Params: AccountNumberParams }>(
    "/internal/ledger/accounts/:accountNumber/balance",
    async (request) => ({
      balance: await ledger.getBalance(request.params.accountNumber),
    }),
  );
  app.post<{ Body: AccountNumbersRequest }>(
    "/internal/ledger/accounts/balances",
    async (request) => ({
      balances: await ledger.getBalances(request.body.accountNumbers),
    }),
  );
  app.post<{ Params: AccountNumberParams }>(
    "/internal/ledger/accounts/:accountNumber/close",
    async (request, reply) => {
      await ledger.closeAccount(request.params.accountNumber);
      return reply.status(204).send();
    },
  );
  app.post<{
    Params: AccountNumberParams;
    Body: PostLedgerTransactionCommand;
    Reply: LedgerTransactionResponse;
  }>(
    "/internal/ledger/accounts/:accountNumber/transactions",
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await ledger.postTransaction(
            postLedgerTransactionCommandSchema.parse(request.body),
          ),
        ),
  );
  app.get<{ Params: AccountNumberParams }>(
    "/internal/ledger/accounts/:accountNumber/transactions",
    async (request) => ({
      transactions: await ledger.listTransactions(request.params.accountNumber),
    }),
  );
  app.get<{ Params: TransactionParams }>(
    "/internal/ledger/accounts/:accountNumber/transactions/:transactionId",
    async (request) =>
      ledger.getTransaction(
        request.params.accountNumber,
        request.params.transactionId,
      ),
  );
  await app.register(healthRoutes(options.prisma));
  return app;
}
