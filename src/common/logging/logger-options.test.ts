import { describe, expect, it } from 'vitest';
import { SENSITIVE_LOG_PATHS, secureLoggerOptions } from './logger-options.js';

describe('secure logger options', () => {
  it('disables logging when requested', () => {
    expect(secureLoggerOptions(false)).toBe(false);
  });

  it('redacts authentication and secret-bearing fields', () => {
    expect(secureLoggerOptions(true)).toEqual({
      redact: {
        paths: [...SENSITIVE_LOG_PATHS],
        censor: '[REDACTED]',
      },
    });
    expect(SENSITIVE_LOG_PATHS).toContain('req.headers.authorization');
    expect(SENSITIVE_LOG_PATHS).toContain('password');
    expect(SENSITIVE_LOG_PATHS).toContain('DATABASE_URL');
  });
});
