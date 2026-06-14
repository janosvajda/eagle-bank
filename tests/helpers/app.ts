import { buildApp } from '../../src/app.js';
import { testPrisma } from './database.js';

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL must identify the isolated integration-test database',
    );
  }
  return databaseUrl;
}

export async function createTestApp() {
  return buildApp({
    prisma: testPrisma,
    config: {
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: requireTestDatabaseUrl(),
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
      AUTH_SERVICE_JWT_SECRET:
        'test-auth-service-secret-that-is-at-least-32-characters',
      LEDGER_SERVICE_JWT_SECRET:
        'test-ledger-service-secret-that-is-at-least-32-characters',
      JWT_EXPIRES_IN: '1h',
      AUTH_SESSION_TTL_SECONDS: 3600,
      AWS_REGION: 'eu-west-2',
      DYNAMODB_AUTH_SESSIONS_TABLE: 'eagle-bank-auth-sessions',
    },
  });
}
