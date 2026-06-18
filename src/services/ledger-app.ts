import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { registerErrorHandler } from '../common/errors/error-handler.js';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { LedgerService } from '../modules/ledger/application/ledger.service.js';
import { LedgerRepository } from '../modules/ledger/persistence/ledger.repository.js';
import { healthRoutes } from '../modules/health/health.routes.js';
import { verifyInternalServiceToken } from '../common/auth/internal-service-jwt.js';
import { ServiceIdentity } from '../common/auth/auth.constants.js';
import type {
  LedgerAccountCommand,
  LedgerAccountResponse,
  LedgerTransactionResponse,
  PostLedgerTransactionCommand,
} from '../modules/ledger/domain/ledger.contracts.js';
import {
  ledgerAccountCommandSchema,
  ledgerAccountNumberSchema,
  postLedgerTransactionCommandSchema,
} from '../modules/ledger/domain/ledger.contracts.js';
import { z } from 'zod';
import {
  HTTP_BODY_LIMIT_BYTES,
  registerHttpSecurity,
} from '../common/security/http-security.js';
import type { Environment } from '../common/config/runtime.constants.js';
import { Environment as RuntimeEnvironment } from '../common/config/runtime.constants.js';
import { secureLoggerOptions } from '../common/logging/logger-options.js';
import { TRANSACTION_API_ID_CONTRACT_PATTERN } from '../modules/transactions/transaction-id.js';

const INTERNAL_ROUTE_PREFIX = '/internal/';

interface AccountNumberParams {
  accountNumber: string;
}

interface TransactionParams extends AccountNumberParams {
  transactionId: string;
}

interface AccountNumbersRequest {
  accountNumbers: string[];
}

const accountNumberParamsSchema = z.object({
  accountNumber: ledgerAccountNumberSchema,
});

const transactionParamsSchema = accountNumberParamsSchema.extend({
  transactionId: z.string().regex(TRANSACTION_API_ID_CONTRACT_PATTERN),
});

const accountNumbersRequestSchema = z
  .object({
    accountNumbers: z.array(ledgerAccountNumberSchema),
  })
  .strict();

export async function buildLedgerApp(options: {
  prisma: PrismaClient;
  internalSecret: string;
  environment?: Environment;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const environment = options.environment ?? RuntimeEnvironment.TEST;
  const app = fastify({
    bodyLimit: HTTP_BODY_LIMIT_BYTES,
    logger: secureLoggerOptions(options.logger ?? false),
  });
  registerHttpSecurity(app, environment);
  registerErrorHandler(app);
  const ledger = new LedgerService(
    new LedgerRepository(options.prisma),
    app.log,
  );

  // Ledger has no public ALB route. The hook still authenticates every internal
  // request so private-network access alone is never treated as authorization.
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith(INTERNAL_ROUTE_PREFIX)) {
      return;
    }

    authenticateInternalLedgerRequest(request, options.internalSecret);
  });

  registerLedgerInternalRoutes(app, ledger);
  await app.register(healthRoutes(options.prisma));
  return app;
}

function authenticateInternalLedgerRequest(
  request: FastifyRequest,
  internalSecret: string,
): void {
  const verification = verifyInternalServiceToken({
    token: request.headers.authorization,
    audience: ServiceIdentity.LEDGER,
    allowedIssuers: [ServiceIdentity.API, ServiceIdentity.ACCOUNT_RECONCILER],
    secret: internalSecret,
  });
  if (!verification.valid) {
    request.log.warn(
      {
        authFailure: verification.reason,
        method: request.method,
        path: request.url,
      },
      'Internal Ledger request rejected',
    );
    throw new AppError(
      httpConstants.HTTP_STATUS_UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Unauthorized',
    );
  }
}

function registerLedgerInternalRoutes(
  app: FastifyInstance,
  ledger: LedgerService,
): void {
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
    async (request) => {
      const { accountNumber } = accountNumberParamsSchema.parse(request.params);
      return { balance: await ledger.getBalance(accountNumber) };
    },
  );
  app.post<{ Body: AccountNumbersRequest }>(
    '/internal/ledger/accounts/balances',
    async (request) => {
      const { accountNumbers } = accountNumbersRequestSchema.parse(
        request.body,
      );
      return { balances: await ledger.getBalances(accountNumbers) };
    },
  );
  app.post<{ Params: AccountNumberParams }>(
    '/internal/ledger/accounts/:accountNumber/close',
    async (request, reply) => {
      const { accountNumber } = accountNumberParamsSchema.parse(request.params);
      await ledger.closeAccount(accountNumber);
      request.log.info({ accountNumber }, 'Ledger account closed');
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
      const { accountNumber } = accountNumberParamsSchema.parse(request.params);
      const command = postLedgerTransactionCommandSchema.parse(request.body);
      if (command.accountNumber !== accountNumber) {
        throw new AppError(
          httpConstants.HTTP_STATUS_BAD_REQUEST,
          ErrorCode.BAD_REQUEST,
          'Path and transaction account numbers must match',
        );
      }
      const transaction = await ledger.postTransaction(command);
      request.log.info(
        {
          accountNumber,
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
    async (request) => {
      const { accountNumber } = accountNumberParamsSchema.parse(request.params);
      return { transactions: await ledger.listTransactions(accountNumber) };
    },
  );
  app.get<{ Params: TransactionParams }>(
    '/internal/ledger/accounts/:accountNumber/transactions/:transactionId',
    async (request) => {
      const { accountNumber, transactionId } = transactionParamsSchema.parse(
        request.params,
      );
      return ledger.getTransaction(accountNumber, transactionId);
    },
  );
}
