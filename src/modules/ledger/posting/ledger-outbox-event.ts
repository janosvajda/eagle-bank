import { randomUUID } from 'node:crypto';
import { MONEY_DECIMAL_PLACES } from '../../../common/constants.js';
import { LedgerEventType } from '../domain/ledger.constants.js';
import type { LedgerTransactionResponse } from '../domain/ledger.contracts.js';
import type {
  LedgerPostingContext,
  LedgerPostingState,
} from './ledger-posting.types.js';
import type { LedgerOutboxRecord } from '../persistence/ledger.repository.js';

// Builds the event stored in the transactional outbox. This keeps event shape
// changes out of the posting coordinator.
export function transactionPostedOutboxEvent(
  context: LedgerPostingContext,
  state: LedgerPostingState,
  response: LedgerTransactionResponse,
): LedgerOutboxRecord {
  const eventId = randomUUID();
  return {
    eventId,
    eventType: LedgerEventType.TRANSACTION_POSTED,
    aggregateId: state.account.accountNumber,
    payload: {
      eventId,
      eventType: LedgerEventType.TRANSACTION_POSTED,
      occurredAt: response.createdTimestamp,
      transactionId: response.id,
      accountNumber: state.account.accountNumber,
      accountId: state.account.accountId,
      userId: context.command.userId,
      type: context.command.type,
      amount: context.command.amount.toFixed(MONEY_DECIMAL_PLACES),
      currency: context.command.currency,
      balanceAfter: state.nextBalance.toFixed(MONEY_DECIMAL_PLACES),
      reference: context.command.reference ?? null,
      requestId: context.command.requestId ?? null,
      correlationId: context.command.correlationId ?? null,
    },
  };
}
