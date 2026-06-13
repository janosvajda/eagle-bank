import fastify, { type FastifyInstance } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import type { PrismaClient } from '@prisma/client';
import { registerErrorHandler } from '../common/errors/error-handler.js';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { LedgerService } from '../modules/ledger/ledger.service.js';
import { LedgerRepository } from '../modules/ledger/ledger.repository.js';
import { healthRoutes } from '../modules/health/health.routes.js';
import { verifyInternalServiceToken } from '../common/auth/internal-service-jwt.js';
import { ServiceIdentity } from '../common/auth/auth.constants.js';
import type {
  LedgerAccountCommand,
  LedgerAccountResponse,
  LedgerTransactionResponse,
  PostLedgerTransactionCommand,
} from '../modules/ledger/ledger.contracts.js';
import {
  ledgerAccountCommandSchema,
  postLedgerTransactionCommandSchema,
} from '../modules/ledger/ledger.contracts.js';

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
  const ledger = new LedgerService(
    new LedgerRepository(options.prisma),
    app.log,
  );

  // Ledger has no public ALB route. The hook still authenticates every internal
  // request so private-network access alone is never treated as authorization.
  app.addHook('preHandler', async (request) => {
    if (
      request.url.startsWith('/internal/') &&
      !verifyInternalServiceToken({
        token: request.headers.authorization,
        audience: ServiceIdentity.LEDGER,
        allowedIssuers: [
          ServiceIdentity.API,
          ServiceIdentity.ACCOUNT_RECONCILER,
        ],
        secret: options.internalSecret,
      })
    ) {
      request.log.warn(
        { method: request.method, path: request.url },
        'Internal Ledger request rejected',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Unauthorized',
      );
    }
  });

  app.post<{ Body: LedgerAccountCommand; Reply: LedgerAccountResponse }>(
    '/internal/ledger/accounts',
    async (request, reply) => {
      const account = await ledger.createAccount(
        ledgerAccountCommandSchema.parse(request.body),
      );
      request.log.info(
        { accountNumber: account.accountNumber, userId: account.userId },
        'Ledger account created',
      );
      return reply.status(httpConstants.HTTP_STATUS_CREATED).send(account);
    },
  );
  app.get<{ Params: AccountNumberParams }>(
    '/internal/ledger/accounts/:accountNumber/balance',
    async (request) => ({
      balance: await ledger.getBalance(request.params.accountNumber),
    }),
  );
  app.post<{ Body: AccountNumbersRequest }>(
    '/internal/ledger/accounts/balances',
    async (request) => ({
      balances: await ledger.getBalances(request.body.accountNumbers),
    }),
  );
  app.post<{ Params: AccountNumberParams }>(
    '/internal/ledger/accounts/:accountNumber/close',
    async (request, reply) => {
      await ledger.closeAccount(request.params.accountNumber);
      request.log.info(
        { accountNumber: request.params.accountNumber },
        'Ledger account closed',
      );
      return reply.status(httpConstants.HTTP_STATUS_NO_CONTENT).send();
    },
  );
  app.post<{
    Params: AccountNumberParams;
    Body: PostLedgerTransactionCommand;
    Reply: LedgerTransactionResponse;
  }>(
    '/internal/ledger/accounts/:accountNumber/transactions',
    async (request, reply) => {
      const transaction = await ledger.postTransaction(
        postLedgerTransactionCommandSchema.parse(request.body),
      );
      request.log.info(
        {
          accountNumber: request.params.accountNumber,
          transactionId: transaction.id,
          transactionType: transaction.type,
          userId: transaction.userId,
        },
        'Ledger transaction posted',
      );
      return reply.status(httpConstants.HTTP_STATUS_CREATED).send(transaction);
    },
  );
  app.get<{ Params: AccountNumberParams }>(
    '/internal/ledger/accounts/:accountNumber/transactions',
    async (request) => ({
      transactions: await ledger.listTransactions(request.params.accountNumber),
    }),
  );
  app.get<{ Params: TransactionParams }>(
    '/internal/ledger/accounts/:accountNumber/transactions/:transactionId',
    async (request) =>
      ledger.getTransaction(
        request.params.accountNumber,
        request.params.transactionId,
      ),
  );
  await app.register(healthRoutes(options.prisma));
  return app;
}
