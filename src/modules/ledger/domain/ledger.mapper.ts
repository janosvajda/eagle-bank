import type {
  LedgerAccount,
  LedgerTransaction,
} from '../../../../generated/prisma/client.js';
import {
  CURRENCY_GBP,
  MONEY_DECIMAL_PLACES,
} from '../../../common/domain/banking.js';
import type {
  LedgerAccountResponse,
  LedgerTransactionResponse,
} from './ledger.contracts.js';
import { formatTransactionApiId } from '../../transactions/transaction-id.js';
import { formatUserApiId } from '../../users/user-id.js';

export function mapLedgerTransaction(
  transaction: LedgerTransaction,
): LedgerTransactionResponse {
  return {
    id: formatTransactionApiId(transaction.id),
    amount: Number(transaction.amount.toFixed(MONEY_DECIMAL_PLACES)),
    currency: CURRENCY_GBP,
    type: transaction.type,
    ...(transaction.reference ? { reference: transaction.reference } : {}),
    userId: formatUserApiId(transaction.userId),
    createdTimestamp: transaction.createdAt.toISOString(),
  };
}

export function mapLedgerAccount(
  account: LedgerAccount,
): LedgerAccountResponse {
  return {
    accountId: account.accountId,
    accountNumber: account.accountNumber,
    userId: formatUserApiId(account.userId),
    currency: CURRENCY_GBP,
    availableBalance: Number(
      account.availableBalance.toFixed(MONEY_DECIMAL_PLACES),
    ),
  };
}
