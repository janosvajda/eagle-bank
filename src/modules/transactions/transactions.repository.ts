import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export class TransactionsRepository {
  constructor(readonly db: PrismaClient) {}

  listByAccount(accountId: string) {
    return this.db.transaction.findMany({
      where: { accountId },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    });
  }

  findByIdAndAccount(transactionId: bigint, accountId: string) {
    return this.db.transaction.findFirst({
      where: { id: transactionId, accountId },
    });
  }
}
