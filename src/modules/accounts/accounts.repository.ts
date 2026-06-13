import type { Prisma, PrismaClient } from "@prisma/client";

export class AccountsRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.BankAccountUncheckedCreateInput) {
    return this.db.bankAccount.create({ data });
  }

  listByUser(userId: string) {
    return this.db.bankAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" }
    });
  }

  findByNumber(accountNumber: string) {
    return this.db.bankAccount.findUnique({ where: { accountNumber } });
  }

  update(accountNumber: string, data: Prisma.BankAccountUpdateInput) {
    return this.db.bankAccount.update({ where: { accountNumber }, data });
  }

  delete(accountNumber: string) {
    return this.db.bankAccount.delete({ where: { accountNumber } });
  }
}
