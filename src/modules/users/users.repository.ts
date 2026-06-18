import {
  AccountStatus,
  type Prisma,
  type PrismaClient,
} from '../../../generated/prisma/client.js';

export class UsersRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: Prisma.UserCreateInput) {
    return this.db.user.create({ data });
  }

  findById(id: bigint) {
    return this.db.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  update(id: bigint, data: Prisma.UserUpdateInput) {
    return this.db.user.update({ where: { id }, data });
  }

  delete(id: bigint) {
    return this.db.user.delete({ where: { id } });
  }

  countAccounts(id: bigint) {
    return this.db.bankAccount.count({
      where: { userId: id, status: { not: AccountStatus.CLOSED } },
    });
  }
}
