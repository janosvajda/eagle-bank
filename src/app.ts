import fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config/env.js';
import { registerErrorHandler } from './common/errors/error-handler.js';
import { UsersRepository } from './modules/users/users.repository.js';
import { UsersService } from './modules/users/users.service.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { AccountsRepository } from './modules/accounts/accounts.repository.js';
import { AccountsService } from './modules/accounts/accounts.service.js';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { TransactionsRepository } from './modules/transactions/transactions.repository.js';
import { TransactionsService } from './modules/transactions/transactions.service.js';
import { transactionsRoutes } from './modules/transactions/transactions.routes.js';
import { registerOpenApiValidation } from './common/openapi/openapi-validation.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { LedgerService } from './modules/ledger/ledger.service.js';
import { LedgerRepository } from './modules/ledger/ledger.repository.js';
import { LedgerHttpClient } from './modules/ledger/ledger.client.js';
import {
  createDynamoDbClient,
  DynamoDbAuthSessionStore,
  InMemoryAuthSessionStore,
} from './modules/auth/auth-session.store.js';
import type { AuthSessionStore } from './modules/auth/auth-session.contracts.js';
import {
  AuthHttpClient,
  RemoteAuthSessionStore,
} from './modules/auth/auth.client.js';
import { SECONDS_PER_HOUR } from './common/constants.js';
import { Environment } from './common/config/runtime.constants.js';

export interface BuildAppOptions {
  prisma: PrismaClient;
  config: Omit<
    AppConfig,
    'AUTH_SESSION_TTL_SECONDS' | 'AWS_REGION' | 'DYNAMODB_AUTH_SESSIONS_TABLE'
  > &
    Partial<
      Pick<
        AppConfig,
        | 'AUTH_SESSION_TTL_SECONDS'
        | 'AWS_REGION'
        | 'DYNAMODB_AUTH_SESSIONS_TABLE'
      >
    >;
  logger?: boolean;
  authSessions?: AuthSessionStore;
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false });

  await app.register(fastifyJwt, { secret: options.config.JWT_SECRET });

  // When a service URL is configured, the API acts as a façade and delegates
  // Auth ownership to the Auth service. Tests can omit it and run in-process.
  const remoteAuth = options.config.AUTH_SERVICE_BASE_URL
    ? new AuthHttpClient(
        options.config.AUTH_SERVICE_BASE_URL,
        options.config.INTERNAL_SERVICE_JWT_SECRET ?? options.config.JWT_SECRET,
        app.log,
      )
    : undefined;
  const authSessions =
    options.authSessions ??
    (remoteAuth
      ? new RemoteAuthSessionStore(remoteAuth)
      : options.config.NODE_ENV === Environment.TEST &&
          !options.config.DYNAMODB_ENDPOINT
        ? new InMemoryAuthSessionStore()
        : new DynamoDbAuthSessionStore(
            createDynamoDbClient({
              environment: options.config.NODE_ENV,
              region: options.config.AWS_REGION ?? 'eu-west-2',
              ...(options.config.DYNAMODB_ENDPOINT
                ? { endpoint: options.config.DYNAMODB_ENDPOINT }
                : {}),
              ...(options.config.AWS_ACCESS_KEY_ID
                ? { accessKeyId: options.config.AWS_ACCESS_KEY_ID }
                : {}),
              ...(options.config.AWS_SECRET_ACCESS_KEY
                ? { secretAccessKey: options.config.AWS_SECRET_ACCESS_KEY }
                : {}),
            }),
            options.config.DYNAMODB_AUTH_SESSIONS_TABLE ??
              'eagle-bank-auth-sessions',
          ));

  // Authentication middleware reads this abstraction without knowing whether
  // sessions are local test data, DynamoDB, or remote Auth introspection.
  app.decorate('authSessions', authSessions);
  registerErrorHandler(app);
  await registerOpenApiValidation(app);

  const usersRepository = new UsersRepository(options.prisma);
  const usersService = new UsersService(usersRepository, remoteAuth, app.log);

  // The same façade supports a split ECS deployment and a compact in-process
  // test topology; domain services depend only on the LedgerGateway contract.
  const ledgerService = options.config.LEDGER_SERVICE_BASE_URL
    ? new LedgerHttpClient(
        options.config.LEDGER_SERVICE_BASE_URL,
        options.config.INTERNAL_SERVICE_JWT_SECRET ?? options.config.JWT_SECRET,
        app.log,
      )
    : new LedgerService(new LedgerRepository(options.prisma), app.log);
  const accountsService = new AccountsService(
    new AccountsRepository(options.prisma),
    ledgerService,
    app.log,
  );
  const transactionsService = new TransactionsService(
    new TransactionsRepository(options.prisma),
    accountsService,
    ledgerService,
    app.log,
  );
  const authService =
    remoteAuth ??
    new AuthService(
      usersRepository,
      app,
      options.config.JWT_EXPIRES_IN,
      authSessions,
      options.config.AUTH_SESSION_TTL_SECONDS ?? SECONDS_PER_HOUR,
    );

  await app.register(usersRoutes(usersService));
  await app.register(authRoutes(authService));
  await app.register(accountsRoutes(accountsService));
  await app.register(transactionsRoutes(transactionsService));
  await app.register(healthRoutes(options.prisma));

  return app;
}
