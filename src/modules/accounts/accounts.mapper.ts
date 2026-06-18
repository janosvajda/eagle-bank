import type { BankAccount } from '../../../generated/prisma/client.js';
import { fromDecimal } from '../../common/money/money.js';

export function mapAccount(account: BankAccount, balance?: number) {
  return {
    accountNumber: account.accountNumber,
    sortCode: account.sortCode,
    name: account.name,
    accountType: account.accountType,
    balance: balance ?? fromDecimal(account.balance),
    currency: account.currency,
    createdTimestamp: account.createdAt.toISOString(),
    updatedTimestamp: account.updatedAt.toISOString(),
  };
}
