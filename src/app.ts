import fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type { PrismaClient } from '../generated/prisma/client.js';
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
import { TransactionsService } from './modules/transactions/transactions.service.js';
import { transactionsRoutes } from './modules/transactions/transactions.routes.js';
import { registerOpenApiValidation } from './common/openapi/openapi-validation.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { LedgerService } from './modules/ledger/application/ledger.service.js';
import { LedgerRepository } from './modules/ledger/persistence/ledger.repository.js';
import { LedgerHttpClient } from './modules/ledger/transport/ledger.client.js';
import {
  createDynamoDbClient,
  DynamoDbAuthSessionStore,
  InMemoryAuthSessionStore,
} from './modules/auth/auth-session.store.js';
import type {
  AuthSessionReader,
  AuthSessionStore,
} from './modules/auth/auth-session.contracts.js';
import {
  AuthHttpClient,
  RemoteAuthSessionStore,
} from './modules/auth/auth.client.js';
import { Environment } from './common/config/runtime.constants.js';
import { userJwtOptions } from './common/auth/user-jwt.js';
import {
  HTTP_BODY_LIMIT_BYTES,
  registerHttpSecurity,
} from './common/security/http-security.js';
import { secureLoggerOptions } from './common/logging/logger-options.js';

export interface BuildAppOptions {
  prisma: PrismaClient;
  config: AppConfig;
  logger?: boolean;
  authSessions?: AuthSessionStore;
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const { config, prisma } = options;
  const app = fastify({
    bodyLimit: HTTP_BODY_LIMIT_BYTES,
    logger: secureLoggerOptions(options.logger ?? false),
  });

  registerHttpSecurity(app, config.NODE_ENV);
  await app.register(fastifyJwt, userJwtOptions(config.JWT_SECRET));

  // When a service URL is configured, the API acts as a façade and delegates
  // Auth ownership to the Auth service. Tests can omit it and run in-process.
  const remoteAuth = createRemoteAuthClient(config, app);
  const localAuthSessions = createAuthSessionStore(config, options);
  const authSessionReader: AuthSessionReader = remoteAuth
    ? new RemoteAuthSessionStore(remoteAuth)
    : localAuthSessions;

  // Authentication middleware only needs session lookup. Session creation is
  // limited to the Auth service/store path and is not exposed by remote API adapters.
  app.decorate('authSessions', authSessionReader);
  registerErrorHandler(app);
  await registerOpenApiValidation(app);

  const usersRepository = new UsersRepository(prisma);
  const usersService = new UsersService(usersRepository, remoteAuth, app.log);

  // The API depends on the LedgerGateway contract. In deployed runtimes this is
  // the private Ledger HTTP client; tests may inject the in-process service.
  const ledgerService = createLedgerGateway(config, prisma, app);
  const accountsService = new AccountsService(
    new AccountsRepository(prisma),
    ledgerService,
    app.log,
  );
  const transactionsService = new TransactionsService(
    accountsService,
    ledgerService,
    app.log,
  );
  const authService =
    remoteAuth ??
    new AuthService(
      usersRepository,
      app,
      config.JWT_EXPIRES_IN,
      localAuthSessions,
      config.AUTH_SESSION_TTL_SECONDS,
    );

  await app.register(usersRoutes(usersService));
  await app.register(authRoutes(authService));
  await app.register(accountsRoutes(accountsService));
  await app.register(transactionsRoutes(transactionsService));
  await app.register(healthRoutes(prisma));

  return app;
}

function createRemoteAuthClient(
  config: AppConfig,
  app: FastifyInstance,
): AuthHttpClient | undefined {
  return config.AUTH_SERVICE_BASE_URL
    ? new AuthHttpClient(
        config.AUTH_SERVICE_BASE_URL,
        config.AUTH_SERVICE_JWT_SECRET,
        app.log,
      )
    : undefined;
}

function createAuthSessionStore(
  config: AppConfig,
  options: BuildAppOptions,
): AuthSessionStore {
  if (options.authSessions) {
    return options.authSessions;
  }
  if (config.NODE_ENV === Environment.TEST && !config.DYNAMODB_ENDPOINT) {
    return new InMemoryAuthSessionStore();
  }
  return new DynamoDbAuthSessionStore(
    createDynamoDbClient({
      environment: config.NODE_ENV,
      region: config.AWS_REGION,
      ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
      ...(config.AWS_ACCESS_KEY_ID
        ? { accessKeyId: config.AWS_ACCESS_KEY_ID }
        : {}),
      ...(config.AWS_SECRET_ACCESS_KEY
        ? { secretAccessKey: config.AWS_SECRET_ACCESS_KEY }
        : {}),
    }),
    config.DYNAMODB_AUTH_SESSIONS_TABLE,
  );
}

function createLedgerGateway(
  config: AppConfig,
  prisma: PrismaClient,
  app: FastifyInstance,
): LedgerHttpClient | LedgerService {
  return config.LEDGER_SERVICE_BASE_URL
    ? new LedgerHttpClient(
        config.LEDGER_SERVICE_BASE_URL,
        config.LEDGER_SERVICE_JWT_SECRET,
        app.log,
      )
    : new LedgerService(new LedgerRepository(prisma), app.log);
}
