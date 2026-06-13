import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../common/middleware/authenticate.js";
import type { UsersService } from "./users.service.js";
import {
  createUserSchema,
  updateUserSchema,
  userParamsSchema
} from "./users.schemas.js";

export function usersRoutes(service: UsersService): FastifyPluginAsync {
  return async (app) => {
    app.post("/v1/users", async (request, reply) => {
      const result = await service.create(createUserSchema.parse(request.body));
      return reply.status(201).send(result);
    });

    app.get("/v1/users/:userId", { preHandler: authenticate }, async (request) => {
      const { userId } = userParamsSchema.parse(request.params);
      return service.get(userId, request.user.sub);
    });

    app.patch(
      "/v1/users/:userId",
      { preHandler: authenticate },
      async (request) => {
        const { userId } = userParamsSchema.parse(request.params);
        return service.update(
          userId,
          request.user.sub,
          updateUserSchema.parse(request.body)
        );
      }
    );

    app.delete(
      "/v1/users/:userId",
      { preHandler: authenticate },
      async (request, reply) => {
        const { userId } = userParamsSchema.parse(request.params);
        await service.delete(userId, request.user.sub);
        return reply.status(204).send();
      }
    );
  };
}
