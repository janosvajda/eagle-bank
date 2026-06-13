import type { FastifyInstance } from "fastify";

export function tokenFor(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId });
}

export function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}
