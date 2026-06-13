import { loadConfig } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import {
  createDynamoDbClient,
  DynamoDbAuthSessionStore
} from "../modules/auth/auth-session.store.js";
import { buildAuthApp } from "./auth-app.js";

const config = loadConfig();
const sessions = new DynamoDbAuthSessionStore(
  createDynamoDbClient({
    region: config.AWS_REGION,
    endpoint: config.DYNAMODB_ENDPOINT,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY
  }),
  config.DYNAMODB_AUTH_SESSIONS_TABLE
);
const app = await buildAuthApp({
  prisma,
  sessions,
  jwtSecret: config.JWT_SECRET,
  jwtExpiresIn: config.JWT_EXPIRES_IN,
  sessionTtlSeconds: config.AUTH_SESSION_TTL_SECONDS,
  internalSecret: config.INTERNAL_SERVICE_JWT_SECRET ?? config.JWT_SECRET,
  logger: true
});
await app.listen({
  host: "0.0.0.0",
  port: Number(process.env.AUTH_SERVICE_PORT ?? config.PORT)
});
