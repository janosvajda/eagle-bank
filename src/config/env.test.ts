import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const required = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/eagle',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters',
};

describe('loadConfig', () => {
  it('parses explicit configuration', () => {
    expect(
      loadConfig({ ...required, PORT: '4000', JWT_EXPIRES_IN: '15m' }),
    ).toEqual({
      ...required,
      PORT: 4000,
      JWT_EXPIRES_IN: '15m',
      AUTH_SESSION_TTL_SECONDS: 3600,
      AWS_REGION: 'eu-west-2',
      DYNAMODB_AUTH_SESSIONS_TABLE: 'eagle-bank-auth-sessions',
    });
  });

  it('applies defaults', () => {
    expect(loadConfig(required)).toMatchObject({
      PORT: 3000,
      JWT_EXPIRES_IN: '1h',
    });
  });

  it('accepts the local Docker Compose environment', () => {
    expect(loadConfig({ ...required, NODE_ENV: 'local' }).NODE_ENV).toBe(
      'local',
    );
  });

  it('rejects unsupported environments and weak secrets', () => {
    expect(() =>
      loadConfig({ ...required, NODE_ENV: 'development' }),
    ).toThrow();
    expect(() => loadConfig({ ...required, JWT_SECRET: 'short' })).toThrow();
  });
});
