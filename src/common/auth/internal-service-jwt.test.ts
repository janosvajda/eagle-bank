import { describe, expect, it } from 'vitest';
import {
  createInternalServiceToken,
  verifyInternalServiceToken,
} from './internal-service-jwt.js';

const secret = 'a-secret-long-enough-for-internal-service-jwt';

describe('internal service JWT', () => {
  it('accepts a signed token for the expected service', () => {
    const token = createInternalServiceToken({
      issuer: 'api',
      audience: 'ledger-service',
      secret,
      now: 100,
    });
    expect(
      verifyInternalServiceToken({
        token: `Bearer ${token}`,
        audience: 'ledger-service',
        allowedIssuers: ['api'],
        secret,
        now: 120,
      }),
    ).toMatchObject({ iss: 'api', aud: 'ledger-service' });
  });

  it('rejects expired, wrongly addressed, and invalid tokens', () => {
    const token = createInternalServiceToken({
      issuer: 'api',
      audience: 'auth-service',
      secret,
      now: 100,
    });
    const verify = (authorization: string | undefined, now = 120) =>
      verifyInternalServiceToken({
        token: authorization,
        audience: 'ledger-service',
        allowedIssuers: ['api'],
        secret,
        now,
      });
    expect(verify(`Bearer ${token}`)).toBeNull();
    expect(verify(`Bearer ${token}x`)).toBeNull();
    expect(verify(undefined)).toBeNull();
    expect(
      verifyInternalServiceToken({
        token: `Bearer ${token}`,
        audience: 'auth-service',
        allowedIssuers: ['api'],
        secret,
        now: 161,
      }),
    ).toBeNull();
  });
});
