import type { FastifyPluginAsync } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import { PUBLIC_API_PREFIX } from '../../common/http/api-version.js';
import { authenticate } from '../../common/middleware/authenticate.js';
import type { TransactionsService } from './transactions.service.js';
import {
  createTransactionSchema,
  transactionAccountParamsSchema,
  transactionParamsSchema,
} from './transactions.schemas.js';

export function transactionsRoutes(
  service: TransactionsService,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', authenticate);

    app.post(
      `${PUBLIC_API_PREFIX}/accounts/:accountNumber/transactions`,
      async (request, reply) => {
        const { accountNumber } = transactionAccountParamsSchema.parse(
          request.params,
        );
        const result = await service.create(
          accountNumber,
          request.user.sub,
          createTransactionSchema.parse(request.body),
          request.headers['idempotency-key'] as string | undefined,
        );
        request.log.info(
          {
            accountNumber,
            transactionId: result.id,
            transactionType: result.type,
            userId: request.user.sub,
          },
          'Transaction posted',
        );
        return reply.status(httpConstants.HTTP_STATUS_CREATED).send(result);
      },
    );

    app.get(
      `${PUBLIC_API_PREFIX}/accounts/:accountNumber/transactions`,
      async (request) => {
        const { accountNumber } = transactionAccountParamsSchema.parse(
          request.params,
        );
        return service.list(accountNumber, request.user.sub);
      },
    );

    app.get(
      `${PUBLIC_API_PREFIX}/accounts/:accountNumber/transactions/:transactionId`,
      async (request) => {
        const { accountNumber, transactionId } = transactionParamsSchema.parse(
          request.params,
        );
        return service.get(accountNumber, transactionId, request.user.sub);
      },
    );
  };
}
