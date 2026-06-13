import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../common/middleware/authenticate.js";
import type { TransactionsService } from "./transactions.service.js";
import {
  createTransactionSchema,
  transactionAccountParamsSchema,
  transactionParamsSchema,
} from "./transactions.schemas.js";

export function transactionsRoutes(
  service: TransactionsService,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post(
      "/v1/accounts/:accountNumber/transactions",
      async (request, reply) => {
        const { accountNumber } = transactionAccountParamsSchema.parse(
          request.params,
        );
        const result = await service.create(
          accountNumber,
          request.user.sub,
          createTransactionSchema.parse(request.body),
          request.headers["idempotency-key"] as string | undefined,
        );
        return reply.status(201).send(result);
      },
    );

    app.get("/v1/accounts/:accountNumber/transactions", async (request) => {
      const { accountNumber } = transactionAccountParamsSchema.parse(
        request.params,
      );
      return service.list(accountNumber, request.user.sub);
    });

    app.get(
      "/v1/accounts/:accountNumber/transactions/:transactionId",
      async (request) => {
        const { accountNumber, transactionId } = transactionParamsSchema.parse(
          request.params,
        );
        return service.get(accountNumber, transactionId, request.user.sub);
      },
    );
  };
}
