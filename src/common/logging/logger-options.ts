const REDACTION_CENSOR = '[REDACTED]';

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
