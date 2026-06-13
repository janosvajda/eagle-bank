export const AccountType = {
  PERSONAL: 'personal',
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

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
