import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadApiConfig,
  loadAuthServiceConfig,
  loadLedgerEventPublisherConfig,
  loadLedgerServiceConfig,
  loadLedgerWorkerConfig,
} from './env.js';

const runtime = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://localhost/eagle',
};
const userJwt = {
  JWT_SECRET: 'a-user-jwt-secret-that-is-at-least-32-characters',
};
const serviceJwt = {
  AUTH_SERVICE_JWT_SECRET:
    'an-auth-service-jwt-secret-that-is-at-least-32-characters',
  LEDGER_SERVICE_JWT_SECRET:
    'a-ledger-service-jwt-secret-that-is-at-least-32-characters',
};

describe('runtime configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses explicit API configuration', () => {
    expect(
      loadApiConfig({
        ...runtime,
        ...userJwt,
        ...serviceJwt,
        PORT: '4000',
        JWT_EXPIRES_IN: '15m',
      }),
    ).toMatchObject({
      PORT: 4000,
      JWT_EXPIRES_IN: '15m',
      AUTH_SESSION_TTL_SECONDS: 3600,
      AWS_REGION: 'eu-west-2',
      DYNAMODB_AUTH_SESSIONS_TABLE: 'eagle-bank-auth-sessions',
    });
  });

  it('requires distinct user and service JWT secrets where needed', () => {
    expect(() => loadApiConfig({ ...runtime, ...userJwt })).toThrow(
      'AUTH_SERVICE_JWT_SECRET',
    );
    expect(() =>
      loadAuthServiceConfig({
        ...runtime,
        AUTH_SERVICE_JWT_SECRET: serviceJwt.AUTH_SERVICE_JWT_SECRET,
      }),
    ).toThrow('JWT_SECRET');
    expect(
      loadLedgerServiceConfig({
        ...runtime,
        LEDGER_SERVICE_JWT_SECRET: serviceJwt.LEDGER_SERVICE_JWT_SECRET,
      }),
    ).not.toHaveProperty('JWT_SECRET');
    expect(() =>
      loadApiConfig({
        ...runtime,
        ...userJwt,
        ...serviceJwt,
        AUTH_SERVICE_JWT_SECRET: userJwt.JWT_SECRET,
      }),
    ).toThrow('User, Auth-service, and Ledger-service JWT secrets must differ');
  });

  it('accepts local AWS overrides and rejects them in AWS environments', () => {
    expect(
      loadAuthServiceConfig({
        ...runtime,
        ...userJwt,
        AUTH_SERVICE_JWT_SECRET: serviceJwt.AUTH_SERVICE_JWT_SECRET,
        NODE_ENV: 'local',
        DYNAMODB_ENDPOINT: 'http://auth-session-db:8000',
      }),
    ).toMatchObject({
      NODE_ENV: 'local',
      DYNAMODB_ENDPOINT: 'http://auth-session-db:8000',
    });
    expect(() =>
      loadLedgerEventPublisherConfig({
        ...runtime,
        NODE_ENV: 'prod',
        SQS_ENDPOINT: 'http://localstack:4566',
        SQS_LEDGER_EVENTS_QUEUE_URL:
          'https://sqs.eu-west-2.amazonaws.com/111111111111/events',
      }),
    ).toThrow('SQS_ENDPOINT is not allowed in prod');
    expect(() =>
      loadApiConfig({
        ...runtime,
        ...userJwt,
        ...serviceJwt,
        NODE_ENV: 'preprod',
        AWS_ACCESS_KEY_ID: 'static-key-is-not-allowed',
      }),
    ).toThrow('AWS_ACCESS_KEY_ID is not allowed in preprod');
  });

  it('parses publisher-specific queue and retry configuration', () => {
    expect(
      loadLedgerEventPublisherConfig({
        ...runtime,
        SQS_LEDGER_EVENTS_QUEUE_URL: 'http://localstack:4566/queue/events',
        LEDGER_EVENT_PUBLISHER_BATCH_SIZE: '20',
      }),
    ).toMatchObject({
      LEDGER_EVENT_PUBLISHER_BATCH_SIZE: 20,
      LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS: 5,
      LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS: 1000,
    });
  });

  it('parses only the asynchronous-command flag for the worker', () => {
    expect(
      loadLedgerWorkerConfig({
        NODE_ENV: 'prod',
        LEDGER_ASYNC_COMMANDS_ENABLED: 'false',
      }),
    ).toEqual({
      NODE_ENV: 'prod',
      LEDGER_ASYNC_COMMANDS_ENABLED: 'false',
    });
    expect(() =>
      loadLedgerWorkerConfig({
        NODE_ENV: 'prod',
        LEDGER_ASYNC_COMMANDS_ENABLED: 'yes',
      }),
    ).toThrow('LEDGER_ASYNC_COMMANDS_ENABLED');
  });

  it('reads process.env when no explicit source is provided', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LEDGER_ASYNC_COMMANDS_ENABLED', 'true');

    expect(loadLedgerWorkerConfig()).toEqual({
      NODE_ENV: 'test',
      LEDGER_ASYNC_COMMANDS_ENABLED: 'true',
    });
  });
});
