export const ACCOUNT_TYPE_PERSONAL = 'personal';
export type AccountType = typeof ACCOUNT_TYPE_PERSONAL;

export const ACCOUNT_NUMBER_CONTRACT_PATTERN = /^01\d{6}$/;

// Public API contract limit from openapi/v1/openapi.yaml. This is not an
// environment setting: changing it changes validation semantics for clients.
export const MAX_TRANSACTION_AMOUNT = 10000;

export const CURRENCY_GBP = 'GBP';
export type Currency = typeof CURRENCY_GBP;

// The current money contract supports ISO currencies with two minor-unit
// decimal places, such as GBP, EUR, and USD. This must stay aligned with the
// OpenAPI money contract and every PostgreSQL DECIMAL(12,2) money column.
export const MONEY_DECIMAL_PLACES = 2;

export const TransactionType = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
} as const;

export type TransactionType =
  (typeof TransactionType)[keyof typeof TransactionType];
