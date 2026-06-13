import { Prisma, type PrismaClient } from '@prisma/client';

export class TransactionsRepository {
  constructor(readonly db: PrismaClient) {}

  listByAccount(accountId: string) {
    return this.db.transaction.findMany({
      where: { accountId },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    });
  }

  findByIdAndAccount(transactionId: string, accountId: string) {
    return this.db.transaction.findFirst({
      where: { id: transactionId, accountId },
    });
  }
}
