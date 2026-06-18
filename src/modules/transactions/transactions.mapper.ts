import type { Transaction } from '../../../generated/prisma/client.js';
import { fromDecimal } from '../../common/money/money.js';
import { formatUserApiId } from '../users/user-id.js';
import { formatTransactionApiId } from './transaction-id.js';

export function mapTransaction(transaction: Transaction) {
  return {
    id: formatTransactionApiId(transaction.id),
    amount: fromDecimal(transaction.amount),
    currency: transaction.currency,
    type: transaction.type,
    ...(transaction.reference ? { reference: transaction.reference } : {}),
    userId: formatUserApiId(transaction.userId),
    createdTimestamp: transaction.createdAt.toISOString(),
  };
}
