export const AccountType = {
  PERSONAL: 'personal',
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const ACCOUNT_NUMBER_CONTRACT_PATTERN = /^01\d{6}$/;

// Public API contract limit from openapi/v1/openapi.yaml. This is not an
// environment setting: changing it changes validation semantics for clients.
export const MAX_TRANSACTION_AMOUNT = 10000;

export const Currency = {
  GBP: 'GBP',
} as const;

export type Currency = (typeof Currency)[keyof typeof Currency];

export const TransactionType = {
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
} as const;

export type TransactionType =
  (typeof TransactionType)[keyof typeof TransactionType];
