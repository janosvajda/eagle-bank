import { z } from 'zod';
import { SECONDS_PER_HOUR } from '../common/constants.js';
import { Environment } from '../common/config/runtime.constants.js';

// Defaults used when an optional environment variable is absent. Required
// connection details and secrets deliberately have no defaults.
const DEFAULT_API_PORT = 3000;
const DEFAULT_JWT_EXPIRES_IN = '1h';
const DEFAULT_AWS_REGION = 'eu-west-2';
const DEFAULT_AUTH_SESSIONS_TABLE = 'eagle-bank-auth-sessions';
const DEFAULT_LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS = 1000;
const DEFAULT_LEDGER_EVENT_PUBLISHER_BATCH_SIZE = 10;
const DEFAULT_LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS = 5;
const DEFAULT_LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS = 30000;
const DEFAULT_LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS = 1000;
const DEFAULT_LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS = 60000;
const MINIMUM_SECRET_LENGTH = 32;

// Environment variables arrive as strings. Reusable validators keep coercion
// and basic constraints consistent when the same field appears in services.
const positiveInteger = z.coerce.number().int().positive();
const nonEmptyString = z.string().min(1);
const secureSecret = z.string().min(MINIMUM_SECRET_LENGTH);

// Database-backed processes need a runtime stage, PostgreSQL connection, and
// AWS region. Static credentials are accepted here only for local emulators;
// env.validation.ts rejects them in deployed AWS environments.
export const databaseRuntimeFields = {
  NODE_ENV: z.enum(Environment),
  DATABASE_URL: nonEmptyString,
  AWS_REGION: nonEmptyString.default(DEFAULT_AWS_REGION),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
};

// HTTP services add their listening port to the database runtime fields.
export const httpRuntimeFields = {
  ...databaseRuntimeFields,
  PORT: positiveInteger.default(DEFAULT_API_PORT),
};

// Explicit endpoints route SDK clients to DynamoDB Local or LocalStack during
// local development. AWS deployments must use normal regional endpoints.
export const awsEndpointFields = {
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  SQS_ENDPOINT: z.string().url().optional(),
};

// JWT fields are separated by trust boundary. The public API token, Auth
// service token, and Ledger service token must not share signing secrets.
export const userJwtFields = {
  JWT_SECRET: secureSecret,
  JWT_EXPIRES_IN: nonEmptyString.default(DEFAULT_JWT_EXPIRES_IN),
};

export const authServiceJwtFields = {
  AUTH_SERVICE_JWT_SECRET: secureSecret,
};

export const ledgerServiceJwtFields = {
  LEDGER_SERVICE_JWT_SECRET: secureSecret,
};

// Auth sessions are stored in DynamoDB and expire using the configured TTL.
export const authSessionFields = {
  AUTH_SESSION_TTL_SECONDS: positiveInteger.default(SECONDS_PER_HOUR),
  DYNAMODB_AUTH_SESSIONS_TABLE: nonEmptyString.default(
    DEFAULT_AUTH_SESSIONS_TABLE,
  ),
};

// The publisher polls the transactional outbox and sends ledger events to
// SQS. These settings control batching, leases, retries, and retry backoff.
export const ledgerEventPublisherFields = {
  SQS_LEDGER_EVENTS_QUEUE_URL: z.string().url(),
  LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS: positiveInteger.default(
    DEFAULT_LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS,
  ),
  LEDGER_EVENT_PUBLISHER_BATCH_SIZE: positiveInteger.default(
    DEFAULT_LEDGER_EVENT_PUBLISHER_BATCH_SIZE,
  ),
  LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS: positiveInteger.default(
    DEFAULT_LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS,
  ),
  LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS: positiveInteger.default(
    DEFAULT_LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS,
  ),
  LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS: positiveInteger.default(
    DEFAULT_LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS,
  ),
  LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS: positiveInteger.default(
    DEFAULT_LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS,
  ),
};
