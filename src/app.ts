import fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config/env.js";
import { registerErrorHandler } from "./common/errors/error-handler.js";
import { UsersRepository } from "./modules/users/users.repository.js";
import { UsersService } from "./modules/users/users.service.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { AccountsRepository } from "./modules/accounts/accounts.repository.js";
import { AccountsService } from "./modules/accounts/accounts.service.js";
import { accountsRoutes } from "./modules/accounts/accounts.routes.js";
import { TransactionsRepository } from "./modules/transactions/transactions.repository.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";
import { transactionsRoutes } from "./modules/transactions/transactions.routes.js";

export interface BuildAppOptions {
  prisma: PrismaClient;
  config: AppConfig;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false });

  await app.register(fastifyJwt, { secret: options.config.JWT_SECRET });
  registerErrorHandler(app);

  const usersRepository = new UsersRepository(options.prisma);
  const usersService = new UsersService(usersRepository);
  const accountsService = new AccountsService(
    new AccountsRepository(options.prisma)
  );
  const transactionsService = new TransactionsService(
    new TransactionsRepository(options.prisma),
    accountsService
  );
  const authService = new AuthService(
    usersRepository,
    app,
    options.config.JWT_EXPIRES_IN
  );

  await app.register(usersRoutes(usersService));
  await app.register(authRoutes(authService));
  await app.register(accountsRoutes(accountsService));
  await app.register(transactionsRoutes(transactionsService));

  return app;
}
