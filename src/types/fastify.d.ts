import "@fastify/jwt";
import "fastify";
import type { AuthSessionStore } from "../modules/auth/auth-session.contracts.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; sid?: string; jti?: string };
    user: { sub: string; sid?: string; jti?: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authSessions: AuthSessionStore;
  }
}
