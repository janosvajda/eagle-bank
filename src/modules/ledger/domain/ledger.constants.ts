import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_HOUR,
} from '../../../common/constants.js';

export const LEDGER_TRANSACTION_ATTEMPTS = 3;
export const LEDGER_FIRST_TRANSACTION_ATTEMPT = 1;
export const LEDGER_IDEMPOTENCY_RETENTION_HOURS = 24;
export const LEDGER_IDEMPOTENCY_RETENTION_MS =
  LEDGER_IDEMPOTENCY_RETENTION_HOURS *
  SECONDS_PER_HOUR *
  MILLISECONDS_PER_SECOND;
export const LEDGER_MINIMUM_IDEMPOTENCY_KEY_LENGTH = 8;
export const LEDGER_REQUEST_TIMEOUT_MS = 2000;
export const LEDGER_BACKOFF_EXPONENTIAL_BASE = 2;
export const LEDGER_JITTER_DIVISOR = 4;
export const LEDGER_MINIMUM_JITTER_RANGE_MS = 1;
export const LEDGER_MAX_ERROR_MESSAGE_LENGTH = 1000;

export const LedgerEventType = {
  TRANSACTION_POSTED: 'TransactionPosted',
} as const;

export type LedgerEventType =
  (typeof LedgerEventType)[keyof typeof LedgerEventType];

export const SqsMessageDataType = {
  STRING: 'String',
} as const;
