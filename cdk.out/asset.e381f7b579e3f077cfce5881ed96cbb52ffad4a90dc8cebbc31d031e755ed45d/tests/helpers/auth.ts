import type { FastifyInstance } from "fastify";
import { InMemoryAuthSessionStore } from "../../src/modules/auth/auth-session.store.js";

export function tokenFor(app: FastifyInstance, userId: string): string {
  const session = (app.authSessions as InMemoryAuthSessionStore).seed(
    userId,
    3600
  );
  return app.jwt.sign({
    sub: userId,
    sid: session.sessionId,
    jti: session.tokenId
  });
}

export function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}
