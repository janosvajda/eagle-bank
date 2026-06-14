import type { FastifyPluginAsync } from 'fastify';
import { loginSchema } from './auth.schemas.js';
import type { LoginInput } from './auth.schemas.js';
import type { LoginResult } from './auth.contracts.js';
import { PUBLIC_API_PREFIX } from '../../common/http/api-version.js';

export interface LoginService {
  login(input: LoginInput): Promise<LoginResult>;
}

export function authRoutes(service: LoginService): FastifyPluginAsync {
  return async (app) => {
    app.post(`${PUBLIC_API_PREFIX}/auth/login`, async (request) => {
      return service.login(loginSchema.parse(request.body));
    });
  };
}
