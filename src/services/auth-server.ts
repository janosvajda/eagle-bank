import { loadAuthServiceConfig } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import {
  createDynamoDbClient,
  DynamoDbAuthSessionStore,
} from '../modules/auth/auth-session.store.js';
import { buildAuthApp } from './auth-app.js';
import { registerServiceShutdown } from './service-shutdown.js';

const config = loadAuthServiceConfig();

// Create the DynamoDB client once at process startup. The Auth session store
// reuses it for every request; shutdown destroys the SDK client's sockets.
const dynamoDbClient = createDynamoDbClient({
  environment: config.NODE_ENV,
  region: config.AWS_REGION,
  ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
  ...(config.AWS_ACCESS_KEY_ID
    ? { accessKeyId: config.AWS_ACCESS_KEY_ID }
    : {}),
  ...(config.AWS_SECRET_ACCESS_KEY
    ? { secretAccessKey: config.AWS_SECRET_ACCESS_KEY }
    : {}),
});
const sessions = new DynamoDbAuthSessionStore(
  dynamoDbClient,
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

// Fastify, Prisma, and the AWS SDK client all hold resources that should be
// released when Docker/ECS/local development stops the process.
registerServiceShutdown({ app, prisma, awsClients: [dynamoDbClient] });
await app.listen({
  host: '0.0.0.0',
  port: config.PORT,
});
