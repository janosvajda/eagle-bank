import { describe, expect, it, vi } from 'vitest';
import { createInternalServiceToken } from '../common/auth/internal-service-jwt.js';
import type { AuthSessionStore } from '../modules/auth/auth-session.contracts.js';
import { buildAuthApp } from './auth-app.js';

const internalSecret = 'internal-secret-that-is-at-least-32-characters';

function authorization(): string {
  const token = createInternalServiceToken({
    issuer: 'api',
    audience: 'auth-service',
    secret: internalSecret,
  });
  return `Bearer ${token}`;
}

async function buildApp(getSession: AuthSessionStore['get']) {
  return buildAuthApp({
    prisma: {} as never,
    sessions: {
      create: vi.fn(),
      get: getSession,
    },
    jwtSecret: 'jwt-secret-that-is-at-least-32-characters',
    jwtExpiresIn: '1h',
    sessionTtlSeconds: 3600,
    internalSecret,
  });
}

const introspectionPayload = {
  userId: 'usr-owner',
  sessionId: 'session-id',
  tokenId: 'token-id',
};

describe('buildAuthApp logging', () => {
  it('warns when an internal request is not authenticated', async () => {
    const app = await buildApp(vi.fn());
    const warnLog = vi.spyOn(app.log, 'warn');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/auth/sessions/introspect',
      payload: introspectionPayload,
    });

    expect(response.statusCode).toBe(401);
    expect(warnLog).toHaveBeenCalledWith(
      {
        authFailure: 'missing_bearer_token',
        method: 'POST',
        path: '/internal/auth/sessions/introspect',
      },
      'Internal Auth request rejected',
    );
    await app.close();
  });

  it('warns when session introspection rejects a session', async () => {
    const app = await buildApp(vi.fn().mockResolvedValue(null));
    const warnLog = vi.spyOn(app.log, 'warn');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/auth/sessions/introspect',
      headers: { authorization: authorization() },
      payload: introspectionPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ session: null });
    expect(warnLog).toHaveBeenCalledWith(
      { sessionId: 'session-id', userId: 'usr-owner' },
      'Authentication session introspection rejected',
    );
    await app.close();
  });

  it('records successful session introspection', async () => {
    const session = {
      tokenId: 'token-id',
      revokedAt: null,
      expiresAtEpoch: Math.floor(Date.now() / 1000) + 3600,
    };
    const app = await buildApp(vi.fn().mockResolvedValue(session));
    const infoLog = vi.spyOn(app.log, 'info');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/auth/sessions/introspect',
      headers: { authorization: authorization() },
      payload: introspectionPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ session });
    expect(infoLog).toHaveBeenCalledWith(
      { sessionId: 'session-id', userId: 'usr-owner' },
      'Authentication session introspected',
    );
    await app.close();
  });
});
