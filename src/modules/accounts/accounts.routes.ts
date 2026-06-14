import type { FastifyPluginAsync } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import { PUBLIC_API_PREFIX } from '../../common/http/api-version.js';
import { authenticate } from '../../common/middleware/authenticate.js';
import type { AccountsService } from './accounts.service.js';
import {
  accountParamsSchema,
  createAccountSchema,
  updateAccountSchema,
} from './accounts.schemas.js';

export function accountsRoutes(service: AccountsService): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', authenticate);

    app.post(`${PUBLIC_API_PREFIX}/accounts`, async (request, reply) => {
      const result = await service.create(
        request.user.sub,
        createAccountSchema.parse(request.body),
      );
      request.log.info(
        { accountNumber: result.accountNumber, userId: request.user.sub },
        'Bank account created',
      );
      return reply.status(httpConstants.HTTP_STATUS_CREATED).send(result);
    });

    app.get(`${PUBLIC_API_PREFIX}/accounts`, async (request) =>
      service.list(request.user.sub),
    );

    app.get(`${PUBLIC_API_PREFIX}/accounts/:accountNumber`, async (request) => {
      const { accountNumber } = accountParamsSchema.parse(request.params);
      return service.get(accountNumber, request.user.sub);
    });

    app.patch(
      `${PUBLIC_API_PREFIX}/accounts/:accountNumber`,
      async (request) => {
        const { accountNumber } = accountParamsSchema.parse(request.params);
        const result = await service.update(
          accountNumber,
          request.user.sub,
          updateAccountSchema.parse(request.body),
        );
        request.log.info(
          { accountNumber, userId: request.user.sub },
          'Bank account updated',
        );
        return result;
      },
    );

    app.delete(
      `${PUBLIC_API_PREFIX}/accounts/:accountNumber`,
      async (request, reply) => {
        const { accountNumber } = accountParamsSchema.parse(request.params);
        await service.delete(accountNumber, request.user.sub);
        request.log.info(
          { accountNumber, userId: request.user.sub },
          'Bank account closed',
        );
        return reply.status(httpConstants.HTTP_STATUS_NO_CONTENT).send();
      },
    );
  };
}
