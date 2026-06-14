import { z } from 'zod';
import {
  authServiceJwtFields,
  authSessionFields,
  awsEndpointFields,
  databaseRuntimeFields,
  httpRuntimeFields,
  ledgerEventPublisherFields,
  ledgerServiceJwtFields,
  ledgerWorkerFields,
  userJwtFields,
} from './env.fields.js';
import {
  rejectLocalAwsOverrides,
  requireDistinctJwtSecrets,
} from './env.validation.js';

// Public API process: HTTP/PostgreSQL settings, all three JWT trust
// boundaries, Auth session access, and optional internal service URLs.
export const apiConfigSchema = z
  .object({
    ...httpRuntimeFields,
    ...userJwtFields,
    ...authServiceJwtFields,
    ...ledgerServiceJwtFields,
    ...authSessionFields,
    ...awsEndpointFields,
    LEDGER_SERVICE_BASE_URL: z.string().url().optional(),
    AUTH_SERVICE_BASE_URL: z.string().url().optional(),
  })
  .superRefine(rejectLocalAwsOverrides)
  .superRefine(requireDistinctJwtSecrets);

// Auth service: user-token signing, internal API authentication, and DynamoDB
// session storage. It does not need the Ledger service secret.
export const authServiceConfigSchema = z
  .object({
    ...httpRuntimeFields,
    ...userJwtFields,
    ...authServiceJwtFields,
    ...authSessionFields,
    ...awsEndpointFields,
  })
  .superRefine(rejectLocalAwsOverrides)
  .superRefine(requireDistinctJwtSecrets);

// Ledger service: PostgreSQL-backed HTTP service authenticated with its
// dedicated internal JWT secret.
export const ledgerServiceConfigSchema = z.object({
  ...httpRuntimeFields,
  ...ledgerServiceJwtFields,
});

// Outbox publisher: PostgreSQL source plus SQS destination and retry controls.
export const ledgerEventPublisherConfigSchema = z
  .object({
    ...databaseRuntimeFields,
    ...awsEndpointFields,
    ...ledgerEventPublisherFields,
  })
  .superRefine(rejectLocalAwsOverrides);

// Asynchronous command worker: intentionally minimal until command
// consumption is enabled.
export const ledgerWorkerConfigSchema = z.object(ledgerWorkerFields);
