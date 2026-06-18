import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { MILLISECONDS_PER_SECOND } from '../constants.js';
import {
  AUTHORIZATION_BEARER_PREFIX,
  INTERNAL_SERVICE_CLOCK_TOLERANCE_SECONDS,
  INTERNAL_SERVICE_TOKEN_TTL_SECONDS,
  JWT_TYPE,
  JwtAlgorithm,
  type ServiceIdentity,
} from './auth.constants.js';

const BEARER_PREFIX_LENGTH = AUTHORIZATION_BEARER_PREFIX.length;
const JWT_SEGMENT_COUNT = 3;

export interface InternalServiceClaims {
  iss: ServiceIdentity;
  aud: ServiceIdentity;
  iat: number;
  exp: number;
  jti: string;
}

export const InternalServiceTokenFailure = {
  MISSING_BEARER_TOKEN: 'missing_bearer_token',
  MALFORMED_TOKEN: 'malformed_token',
  UNSUPPORTED_HEADER: 'unsupported_header',
  INVALID_CLAIMS: 'invalid_claims',
  INVALID_SIGNATURE: 'invalid_signature',
  INVALID_AUDIENCE: 'invalid_audience',
  INVALID_ISSUER: 'invalid_issuer',
  EXPIRED: 'expired',
  ISSUED_IN_FUTURE: 'issued_in_future',
  INVALID_LIFETIME: 'invalid_lifetime',
} as const;

export type InternalServiceTokenFailure =
  (typeof InternalServiceTokenFailure)[keyof typeof InternalServiceTokenFailure];

export type InternalServiceTokenVerification =
  | { valid: true; claims: InternalServiceClaims }
  | { valid: false; reason: InternalServiceTokenFailure };

interface JwtHeader {
  alg: string;
  typ: string;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function isJwtHeader(value: unknown): value is JwtHeader {
  return (
    typeof value === 'object' &&
    value !== null &&
    'alg' in value &&
    value.alg === JwtAlgorithm.HMAC_SHA_256 &&
    'typ' in value &&
    value.typ === JWT_TYPE
  );
}

function isInternalServiceClaims(
  value: unknown,
): value is InternalServiceClaims {
  return (
    typeof value === 'object' &&
    value !== null &&
    'iss' in value &&
    typeof value.iss === 'string' &&
    'aud' in value &&
    typeof value.aud === 'string' &&
    'iat' in value &&
    Number.isInteger(value.iat) &&
    'exp' in value &&
    Number.isInteger(value.exp) &&
    'jti' in value &&
    typeof value.jti === 'string' &&
    value.jti.length > 0
  );
}

function signature(value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

function rejected(
  reason: InternalServiceTokenFailure,
): InternalServiceTokenVerification {
  return { valid: false, reason };
}

// Internal tokens are deliberately short-lived and audience-bound. They prove
// service identity but are not user access tokens and carry no user authority.
export function createInternalServiceToken(options: {
  issuer: ServiceIdentity;
  audience: ServiceIdentity;
  secret: string;
  now?: number;
}): string {
  const issuedAt =
    options.now ?? Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
  const header = encode({
    alg: JwtAlgorithm.HMAC_SHA_256,
    typ: JWT_TYPE,
  });
  const payload = encode({
    iss: options.issuer,
    aud: options.audience,
    iat: issuedAt,
    exp: issuedAt + INTERNAL_SERVICE_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned, options.secret).toString('base64url')}`;
}

export function verifyInternalServiceToken(options: {
  token: string | undefined;
  audience: ServiceIdentity;
  allowedIssuers: ServiceIdentity[];
  secret: string;
  now?: number;
}): InternalServiceTokenVerification {
  if (!options.token?.startsWith(AUTHORIZATION_BEARER_PREFIX)) {
    return rejected(InternalServiceTokenFailure.MISSING_BEARER_TOKEN);
  }

  const parts = options.token.slice(BEARER_PREFIX_LENGTH).split('.');
  if (parts.length !== JWT_SEGMENT_COUNT) {
    return rejected(InternalServiceTokenFailure.MALFORMED_TOKEN);
  }

  const [header, payload, encodedSignature] = parts;
  if (!header || !payload || !encodedSignature) {
    return rejected(InternalServiceTokenFailure.MALFORMED_TOKEN);
  }

  try {
    const decodedHeader = decodeJson(header);
    const claims = decodeJson(payload);
    if (!isJwtHeader(decodedHeader)) {
      return rejected(InternalServiceTokenFailure.UNSUPPORTED_HEADER);
    }
    if (!isInternalServiceClaims(claims)) {
      return rejected(InternalServiceTokenFailure.INVALID_CLAIMS);
    }

    const unsigned = `${header}.${payload}`;
    const supplied = Buffer.from(encodedSignature, 'base64url');
    const expected = signature(unsigned, options.secret);

    // Compare signatures in constant time to avoid leaking matching-prefix
    // information through response timing.
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return rejected(InternalServiceTokenFailure.INVALID_SIGNATURE);
    }

    const now = options.now ?? Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
    if (claims.aud !== options.audience) {
      return rejected(InternalServiceTokenFailure.INVALID_AUDIENCE);
    }
    if (!options.allowedIssuers.includes(claims.iss)) {
      return rejected(InternalServiceTokenFailure.INVALID_ISSUER);
    }
    if (claims.exp <= now) {
      return rejected(InternalServiceTokenFailure.EXPIRED);
    }
    if (claims.iat > now + INTERNAL_SERVICE_CLOCK_TOLERANCE_SECONDS) {
      return rejected(InternalServiceTokenFailure.ISSUED_IN_FUTURE);
    }
    if (claims.exp - claims.iat > INTERNAL_SERVICE_TOKEN_TTL_SECONDS) {
      return rejected(InternalServiceTokenFailure.INVALID_LIFETIME);
    }

    return { valid: true, claims };
  } catch {
    return rejected(InternalServiceTokenFailure.MALFORMED_TOKEN);
  }
}
