import type { FastifyPluginAsync } from "fastify";
import { loginSchema } from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";

export function authRoutes(service: AuthService): FastifyPluginAsync {
  return async (app) => {
    app.post("/v1/auth/login", async (request) => {
      return service.login(loginSchema.parse(request.body));
    });
  };
}
