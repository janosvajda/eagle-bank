import type { BankAccount } from "@prisma/client";
import { fromDecimal } from "../../common/money/money.js";

export function mapAccount(account: BankAccount) {
  return {
    accountNumber: account.accountNumber,
    sortCode: account.sortCode,
    name: account.name,
    accountType: account.accountType,
    balance: fromDecimal(account.balance),
    currency: account.currency,
    createdTimestamp: account.createdAt.toISOString(),
    updatedTimestamp: account.updatedAt.toISOString()
  };
}
