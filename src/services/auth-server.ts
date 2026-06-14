import { loadAuthServiceConfig } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import {
  createDynamoDbClient,
  DynamoDbAuthSessionStore,
} from '../modules/auth/auth-session.store.js';
import { buildAuthApp } from './auth-app.js';

const config = loadAuthServiceConfig();
const sessions = new DynamoDbAuthSessionStore(
  createDynamoDbClient({
    environment: config.NODE_ENV,
    region: config.AWS_REGION,
    ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
    ...(config.AWS_ACCESS_KEY_ID
      ? { accessKeyId: config.AWS_ACCESS_KEY_ID }
      : {}),
    ...(config.AWS_SECRET_ACCESS_KEY
      ? { secretAccessKey: config.AWS_SECRET_ACCESS_KEY }
      : {}),
  }),
  config.DYNAMODB_AUTH_SESSIONS_TABLE,
);
const app = await buildAuthApp({
  prisma,
  sessions,
  jwtSecret: config.JWT_SECRET,
  jwtExpiresIn: config.JWT_EXPIRES_IN,
  sessionTtlSeconds: config.AUTH_SESSION_TTL_SECONDS,
  internalSecret: config.AUTH_SERVICE_JWT_SECRET,
  environment: config.NODE_ENV,
  logger: true,
});
await app.listen({
  host: '0.0.0.0',
  port: config.PORT,
});
