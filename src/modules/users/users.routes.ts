import type { FastifyPluginAsync } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import { PUBLIC_API_PREFIX } from '../../common/http/api-version.js';
import { authenticate } from '../../common/middleware/authenticate.js';
import type { UsersService } from './users.service.js';
import {
  createUserSchema,
  updateUserSchema,
  userParamsSchema,
} from './users.schemas.js';

export function usersRoutes(service: UsersService): FastifyPluginAsync {
  return async (app) => {
    app.post(`${PUBLIC_API_PREFIX}/users`, async (request, reply) => {
      const result = await service.create(createUserSchema.parse(request.body));
      request.log.info({ userId: result.id }, 'User created');
      return reply.status(httpConstants.HTTP_STATUS_CREATED).send(result);
    });

    app.get(
      `${PUBLIC_API_PREFIX}/users/:userId`,
      { preHandler: authenticate },
      async (request) => {
        const { userId } = userParamsSchema.parse(request.params);
        return service.get(userId, request.user.sub);
      },
    );

    app.patch(
      `${PUBLIC_API_PREFIX}/users/:userId`,
      { preHandler: authenticate },
      async (request) => {
        const { userId } = userParamsSchema.parse(request.params);
        const result = await service.update(
          userId,
          request.user.sub,
          updateUserSchema.parse(request.body),
        );
        request.log.info({ userId }, 'User profile updated');
        return result;
      },
    );

    app.delete(
      `${PUBLIC_API_PREFIX}/users/:userId`,
      { preHandler: authenticate },
      async (request, reply) => {
        const { userId } = userParamsSchema.parse(request.params);
        await service.delete(userId, request.user.sub);
        request.log.info({ userId }, 'User deleted');
        return reply.status(httpConstants.HTTP_STATUS_NO_CONTENT).send();
      },
    );
  };
}
