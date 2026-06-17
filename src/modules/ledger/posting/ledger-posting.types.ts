import {
  Prisma,
  type LedgerAccount,
} from '../../../generated/prisma/client.js';
import type { PostLedgerTransactionCommand } from '../domain/ledger.contracts.js';

export interface LedgerPostingContext {
  command: PostLedgerTransactionCommand;
  requestHash: string;
  userId: bigint;
}

export interface LedgerPostingState {
  account: LedgerAccount;
  amount: Prisma.Decimal;
  nextBalance: Prisma.Decimal;
}
