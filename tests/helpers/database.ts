import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

export async function resetDatabase(): Promise<void> {
  await testPrisma.$transaction([
    testPrisma.transaction.deleteMany(),
    testPrisma.bankAccount.deleteMany(),
    testPrisma.user.deleteMany()
  ]);
}
