export const AuthTokenType = {
  BEARER: 'Bearer',
} as const;

export const AUTHORIZATION_BEARER_PREFIX = `${AuthTokenType.BEARER} `;

export const ServiceIdentity = {
  ACCOUNT_RECONCILER: 'account-reconciler',
  API: 'api',
  AUTH: 'auth-service',
  LEDGER: 'ledger-service',
} as const;

export type ServiceIdentity =
  (typeof ServiceIdentity)[keyof typeof ServiceIdentity];
