import type {
  AccountStatus,
  AccountType,
  Prisma,
} from '../../generated/prisma/client.js';

// Account ownership checks need only the owner's database ID. Deriving the
// result from Prisma keeps this type aligned with the selected relation.
export type BankAccountWithOwner = Prisma.BankAccountGetPayload<{
  include: {
    user: {
      select: {
        id: true;
      };
    };
  };
}>;

// The account service owns account-number allocation and lifecycle choice.
// The repository accepts only the fields required to persist that decision.
export interface CreateBankAccountRecord {
  accountNumber: string;
  name: string;
  accountType: AccountType;
  status: AccountStatus;
}

// Public account updates cannot modify ownership, balance, currency, or
// lifecycle state.
export interface UpdateBankAccountRecord {
  name?: string;
  accountType?: AccountType;
}
