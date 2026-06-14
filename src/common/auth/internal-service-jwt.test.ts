import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createInternalServiceToken,
  InternalServiceTokenFailure,
  verifyInternalServiceToken,
} from './internal-service-jwt.js';

const secret = 'a-secret-long-enough-for-internal-service-jwt';

function resign(header: object, payload: object): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(unsigned)
    .digest('base64url');
  return `${unsigned}.${signature}`;
}

describe('internal service JWT', () => {
  it('accepts a signed token for the expected service', () => {
    const token = createInternalServiceToken({
      issuer: 'api',
      audience: 'ledger-service',
      secret,
      now: 100,
    });
    const result = verifyInternalServiceToken({
      token: `Bearer ${token}`,
      audience: 'ledger-service',
      allowedIssuers: ['api'],
      secret,
      now: 120,
    });

    expect(result).toEqual({
      valid: true,
      claims: expect.objectContaining({
        iss: 'api',
        aud: 'ledger-service',
      }),
    });
  });

  it('categorizes missing, malformed, and incorrectly signed tokens', () => {
    const verify = (authorization: string | undefined) =>
      verifyInternalServiceToken({
        token: authorization,
        audience: 'ledger-service',
        allowedIssuers: ['api'],
        secret,
        now: 120,
      });
    const token = createInternalServiceToken({
      issuer: 'api',
      audience: 'ledger-service',
      secret,
      now: 100,
    });

    expect(verify(undefined)).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.MISSING_BEARER_TOKEN,
    });
    expect(verify('Bearer not-a-jwt')).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.MALFORMED_TOKEN,
    });
    expect(verify('Bearer .e30.signature')).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.MALFORMED_TOKEN,
    });
    expect(verify('Bearer !!!.e30.signature')).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.MALFORMED_TOKEN,
    });
    expect(verify('Bearer e30.e30.invalid')).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.UNSUPPORTED_HEADER,
    });
    expect(verify(`Bearer ${token}x`)).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.INVALID_SIGNATURE,
    });
  });

  it('rejects signed tokens with an unexpected header or malformed claims', () => {
    const claims = {
      iss: 'api',
      aud: 'ledger-service',
      iat: 100,
      exp: 160,
      jti: 'token-id',
    };
    const verify = (token: string) =>
      verifyInternalServiceToken({
        token: `Bearer ${token}`,
        audience: 'ledger-service',
        allowedIssuers: ['api'],
        secret,
        now: 120,
      });

    expect(verify(resign({ alg: 'HS512', typ: 'JWT' }, claims))).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.UNSUPPORTED_HEADER,
    });
    expect(verify(resign({ alg: 'HS256', typ: 'not-jwt' }, claims))).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.UNSUPPORTED_HEADER,
    });
    expect(
      verify(resign({ alg: 'HS256', typ: 'JWT' }, { ...claims, exp: '160' })),
    ).toEqual({
      valid: false,
      reason: InternalServiceTokenFailure.INVALID_CLAIMS,
    });
  });

  it.each([
    [
      'wrong audience',
      { iss: 'api', aud: 'auth-service', iat: 100, exp: 160, jti: 'id' },
      120,
      InternalServiceTokenFailure.INVALID_AUDIENCE,
    ],
    [
      'wrong issuer',
      {
        iss: 'account-reconciler',
        aud: 'ledger-service',
        iat: 100,
        exp: 160,
        jti: 'id',
      },
      120,
      InternalServiceTokenFailure.INVALID_ISSUER,
    ],
    [
      'expired token',
      { iss: 'api', aud: 'ledger-service', iat: 100, exp: 160, jti: 'id' },
      160,
      InternalServiceTokenFailure.EXPIRED,
    ],
    [
      'future token',
      { iss: 'api', aud: 'ledger-service', iat: 126, exp: 160, jti: 'id' },
      120,
      InternalServiceTokenFailure.ISSUED_IN_FUTURE,
    ],
    [
      'excessive lifetime',
      { iss: 'api', aud: 'ledger-service', iat: 100, exp: 161, jti: 'id' },
      120,
      InternalServiceTokenFailure.INVALID_LIFETIME,
    ],
  ])('categorizes a signed %s', (_label, claims, now, reason) => {
    expect(
      verifyInternalServiceToken({
        token: `Bearer ${resign({ alg: 'HS256', typ: 'JWT' }, claims)}`,
        audience: 'ledger-service',
        allowedIssuers: ['api'],
        secret,
        now,
      }),
    ).toEqual({ valid: false, reason });
  });
});
