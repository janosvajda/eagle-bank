import type { Prisma, PrismaClient } from "@prisma/client";

export class UsersRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.UserCreateInput) {
    return this.db.user.create({ data });
  }

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.db.user.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.db.user.delete({ where: { id } });
  }

  countAccounts(id: string) {
    return this.db.bankAccount.count({
      where: { userId: id, status: { not: "CLOSED" } }
    });
  }
}
