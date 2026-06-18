const REDACTION_CENSOR = '[REDACTED]';

// Pino redaction paths for values that must never be written to logs.
// The list covers common Fastify request/response shapes plus application
// fields that may appear in structured log context objects.
export const SENSITIVE_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'res.headers.set-cookie',
  'authorization',
  'cookie',
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'token',
  'secret',
  'DATABASE_URL',
  'JWT_SECRET',
  'AUTH_SERVICE_JWT_SECRET',
  'LEDGER_SERVICE_JWT_SECRET',
] as const;

// Fastify accepts `false` to disable logging. When logging is enabled, always
// attach the redaction policy so secrets are censored before log output.
export function secureLoggerOptions(enabled: boolean) {
  return enabled
    ? {
        redact: {
          paths: [...SENSITIVE_LOG_PATHS],
          censor: REDACTION_CENSOR,
        },
      }
    : false;
}
