import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../common/middleware/authenticate.js";
import type { AccountsService } from "./accounts.service.js";
import {
  accountParamsSchema,
  createAccountSchema,
  updateAccountSchema,
} from "./accounts.schemas.js";

export function accountsRoutes(service: AccountsService): FastifyPluginAsync {
  return async (app) => {
    app.addHook("preHandler", authenticate);

    app.post("/v1/accounts", async (request, reply) => {
      const result = await service.create(
        request.user.sub,
        createAccountSchema.parse(request.body),
      );
      return reply.status(201).send(result);
    });

    app.get("/v1/accounts", async (request) => service.list(request.user.sub));

    app.get("/v1/accounts/:accountNumber", async (request) => {
      const { accountNumber } = accountParamsSchema.parse(request.params);
      return service.get(accountNumber, request.user.sub);
    });

    app.patch("/v1/accounts/:accountNumber", async (request) => {
      const { accountNumber } = accountParamsSchema.parse(request.params);
      return service.update(
        accountNumber,
        request.user.sub,
        updateAccountSchema.parse(request.body),
      );
    });

    app.delete("/v1/accounts/:accountNumber", async (request, reply) => {
      const { accountNumber } = accountParamsSchema.parse(request.params);
      await service.delete(accountNumber, request.user.sub);
      return reply.status(204).send();
    });
  };
}
