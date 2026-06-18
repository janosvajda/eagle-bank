import fastify, { type FastifyInstance } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import fastifyJwt from '@fastify/jwt';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { registerErrorHandler } from '../common/errors/error-handler.js';
import { registerOpenApiValidation } from '../common/openapi/openapi-validation.js';
import { AppError } from '../common/errors/AppError.js';
import { ErrorCode } from '../common/errors/error-codes.js';
import { UsersRepository } from '../modules/users/users.repository.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import type { AuthSessionStore } from '../modules/auth/auth-session.contracts.js';
import type {
  PasswordHashRequest,
  PasswordHashResponse,
  SessionIntrospectionRequest,
  SessionIntrospectionResponse,
} from '../modules/auth/auth.contracts.js';
import {
  passwordHashRequestSchema,
  sessionIntrospectionRequestSchema,
} from '../modules/auth/auth.contracts.js';
import { healthRoutes } from '../modules/health/health.routes.js';
import { verifyInternalServiceToken } from '../common/auth/internal-service-jwt.js';
import { ServiceIdentity } from '../common/auth/auth.constants.js';
import { MILLISECONDS_PER_SECOND } from '../common/constants.js';
import { hashPassword } from '../common/password/password.js';
import { userJwtOptions } from '../common/auth/user-jwt.js';
import {
  HTTP_BODY_LIMIT_BYTES,
  registerHttpSecurity,
} from '../common/security/http-security.js';
import { Environment } from '../common/config/runtime.constants.js';
import { secureLoggerOptions } from '../common/logging/logger-options.js';

export async function buildAuthApp(options: {
  prisma: PrismaClient;
  sessions: AuthSessionStore;
  jwtSecret: string;
  jwtExpiresIn: string;
  sessionTtlSeconds: number;
  internalSecret: string;
  environment?: Environment;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const environment = options.environment ?? Environment.TEST;
  const app = fastify({
    bodyLimit: HTTP_BODY_LIMIT_BYTES,
    logger: secureLoggerOptions(options.logger ?? false),
  });
  registerHttpSecurity(app, environment);
  await app.register(fastifyJwt, userJwtOptions(options.jwtSecret));
  app.decorate('authSessions', options.sessions);
  registerErrorHandler(app);
  await registerOpenApiValidation(app);
  const auth = new AuthService(
    new UsersRepository(options.prisma),
    app,
    options.jwtExpiresIn,
    options.sessions,
    options.sessionTtlSeconds,
  );
  await app.register(authRoutes(auth));

  // Public login is allowed through the ALB. Every /internal route requires a
  // short-lived token issued specifically by the API for the Auth audience.
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/internal/')) {
      return;
    }

    const verification = verifyInternalServiceToken({
      token: request.headers.authorization,
      audience: ServiceIdentity.AUTH,
      allowedIssuers: [ServiceIdentity.API],
      secret: options.internalSecret,
    });
    if (!verification.valid) {
      request.log.warn(
        {
          authFailure: verification.reason,
          method: request.method,
          path: request.url,
        },
        'Internal Auth request rejected',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Unauthorized',
      );
    }
  });
  app.post<{ Body: PasswordHashRequest; Reply: PasswordHashResponse }>(
    '/internal/auth/password-hash',
    async (request) => ({
      passwordHash: await hashPassword(
        passwordHashRequestSchema.parse(request.body).password,
      ),
    }),
  );
  app.post<{
    Body: SessionIntrospectionRequest;
    Reply: SessionIntrospectionResponse;
  }>('/internal/auth/sessions/introspect', async (request) => {
    const body = sessionIntrospectionRequestSchema.parse(request.body);
    const session = await options.sessions.get(body.userId, body.sessionId);

    // A valid JWT is insufficient by itself: the backing session must still
    // exist, match its token id, remain unrevoked, and be unexpired.
    if (
      !session ||
      session.tokenId !== body.tokenId ||
      session.revokedAt ||
      session.expiresAtEpoch <= Math.floor(Date.now() / MILLISECONDS_PER_SECOND)
    ) {
      request.log.warn(
        { sessionId: body.sessionId, userId: body.userId },
        'Authentication session introspection rejected',
      );
      return { session: null };
    }
    request.log.info(
      { sessionId: body.sessionId, userId: body.userId },
      'Authentication session introspected',
    );
    return { session };
  });
  await app.register(healthRoutes(options.prisma));
  return app;
}
