import {
  AccountStatus,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma/client.js';
import type {
  BankAccountWithOwner,
  CreateBankAccountRecord,
  UpdateBankAccountRecord,
} from './accounts.repository.types.js';

const ACCOUNT_OWNER_INCLUDE = {
  user: {
    select: {
      id: true,
    },
  },
} as const satisfies Prisma.BankAccountInclude;

export type { BankAccountWithOwner } from './accounts.repository.types.js';

export class AccountsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(userId: bigint, account: CreateBankAccountRecord) {
    return this.db.bankAccount.create({
      data: {
        ...account,
        user: { connect: { id: userId } },
      },
    });
  }

  listByUser(userId: bigint) {
    return this.db.bankAccount.findMany({
      where: {
        userId,
        status: AccountStatus.ACTIVE,
      },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    });
  }

  findByNumber(accountNumber: string): Promise<BankAccountWithOwner | null> {
    return this.db.bankAccount.findUnique({
      where: { accountNumber },
      include: ACCOUNT_OWNER_INCLUDE,
    });
  }

  update(accountNumber: string, changes: UpdateBankAccountRecord) {
    return this.db.bankAccount.update({
      where: { accountNumber },
      data: changes,
    });
  }

  delete(accountNumber: string) {
    return this.db.bankAccount.delete({ where: { accountNumber } });
  }

  setStatus(accountNumber: string, status: AccountStatus) {
    return this.db.bankAccount.update({
      where: { accountNumber },
      data: { status },
    });
  }

  close(accountNumber: string) {
    return this.db.bankAccount.update({
      where: { accountNumber },
      data: { status: AccountStatus.CLOSED, deletedAt: new Date() },
    });
  }
}
