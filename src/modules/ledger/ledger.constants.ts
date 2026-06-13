export const LedgerEventType = {
  TRANSACTION_POSTED: 'TransactionPosted',
} as const;

export type LedgerEventType =
  (typeof LedgerEventType)[keyof typeof LedgerEventType];

export const SqsMessageDataType = {
  STRING: 'String',
} as const;
