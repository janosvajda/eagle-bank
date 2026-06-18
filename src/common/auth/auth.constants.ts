export const AuthTokenType = {
  BEARER: 'Bearer',
} as const;

export const AUTHORIZATION_BEARER_PREFIX = `${AuthTokenType.BEARER} `;

export const JwtAlgorithm = {
  HMAC_SHA_256: 'HS256',
} as const;

export const JWT_TYPE = 'JWT';

// User-token issuer/audience are part of the security contract between Auth
// and the public API. They are intentionally not environment-specific secrets;
// changing them per deployment would make valid tokens fail across services.
export const USER_JWT_ISSUER = 'eagle-bank-auth';
export const USER_JWT_AUDIENCE = 'eagle-bank-api';

// Internal service tokens are deliberately short-lived. They prove service
// identity only and carry no user authority.
export const INTERNAL_SERVICE_TOKEN_TTL_SECONDS = 60;
export const INTERNAL_SERVICE_CLOCK_TOLERANCE_SECONDS = 5;

export const ServiceIdentity = {
  ACCOUNT_RECONCILER: 'account-reconciler',
  API: 'api',
  AUTH: 'auth-service',
  LEDGER: 'ledger-service',
} as const;

export type ServiceIdentity =
  (typeof ServiceIdentity)[keyof typeof ServiceIdentity];
