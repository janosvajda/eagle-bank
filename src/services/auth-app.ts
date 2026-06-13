import argon2 from "argon2";
import fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { PrismaClient } from "@prisma/client";
import { registerErrorHandler } from "../common/errors/error-handler.js";
import { registerOpenApiValidation } from "../common/openapi/openapi-validation.js";
import { AppError } from "../common/errors/AppError.js";
import { ErrorCode } from "../common/errors/error-codes.js";
import { UsersRepository } from "../modules/users/users.repository.js";
import { AuthService } from "../modules/auth/auth.service.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import type { AuthSessionStore } from "../modules/auth/auth-session.contracts.js";
import type {
  PasswordHashRequest,
  PasswordHashResponse,
  SessionIntrospectionRequest,
  SessionIntrospectionResponse,
} from "../modules/auth/auth.contracts.js";
import {
  passwordHashRequestSchema,
  sessionIntrospectionRequestSchema,
} from "../modules/auth/auth.contracts.js";
import { healthRoutes } from "../modules/health/health.routes.js";
import { verifyInternalServiceToken } from "../common/auth/internal-service-jwt.js";
import { MILLISECONDS_PER_SECOND } from "../common/constants.js";

export async function buildAuthApp(options: {
  prisma: PrismaClient;
  sessions: AuthSessionStore;
  jwtSecret: string;
  jwtExpiresIn: string;
  sessionTtlSeconds: number;
  internalSecret: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false });
  await app.register(fastifyJwt, { secret: options.jwtSecret });
  app.decorate("authSessions", options.sessions);
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
  app.addHook("preHandler", async (request) => {
    if (
      request.url.startsWith("/internal/") &&
      !verifyInternalServiceToken({
        token: request.headers.authorization,
        audience: "auth-service",
        allowedIssuers: ["api"],
        secret: options.internalSecret,
      })
    ) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, "Unauthorized");
    }
  });
  app.post<{ Body: PasswordHashRequest; Reply: PasswordHashResponse }>(
    "/internal/auth/password-hash",
    async (request) => ({
      passwordHash: await argon2.hash(
        passwordHashRequestSchema.parse(request.body).password,
      ),
    }),
  );
  app.post<{
    Body: SessionIntrospectionRequest;
    Reply: SessionIntrospectionResponse;
  }>("/internal/auth/sessions/introspect", async (request) => {
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
      return { session: null };
    }
    return { session };
  });
  await app.register(healthRoutes(options.prisma));
  return app;
}
