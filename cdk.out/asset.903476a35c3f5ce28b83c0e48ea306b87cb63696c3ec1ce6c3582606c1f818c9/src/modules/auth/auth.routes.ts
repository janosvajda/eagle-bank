import type { FastifyPluginAsync } from "fastify";
import { loginSchema } from "./auth.schemas.js";
import type { LoginInput } from "./auth.schemas.js";
import type { LoginResult } from "./auth.client.js";

export interface LoginService {
  login(input: LoginInput): Promise<LoginResult>;
}

export function authRoutes(service: LoginService): FastifyPluginAsync {
  return async (app) => {
    app.post("/v1/auth/login", async (request) => {
      return service.login(loginSchema.parse(request.body));
    });
  };
}
