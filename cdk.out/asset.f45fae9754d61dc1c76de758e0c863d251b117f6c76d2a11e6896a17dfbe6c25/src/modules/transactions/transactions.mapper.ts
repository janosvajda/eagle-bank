import type { Transaction } from "@prisma/client";
import { fromDecimal } from "../../common/money/money.js";

export function mapTransaction(transaction: Transaction) {
  return {
    id: transaction.id,
    amount: fromDecimal(transaction.amount),
    currency: transaction.currency,
    type: transaction.type,
    ...(transaction.reference ? { reference: transaction.reference } : {}),
    userId: transaction.userId,
    createdTimestamp: transaction.createdAt.toISOString()
  };
}
