import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

export async function resetDatabase(): Promise<void> {
  await testPrisma.$transaction([
    testPrisma.ledgerEntry.deleteMany(),
    testPrisma.ledgerTransaction.deleteMany(),
    testPrisma.ledgerIdempotencyKey.deleteMany(),
    testPrisma.ledgerOutboxEvent.deleteMany(),
    testPrisma.ledgerAccount.deleteMany(),
    testPrisma.transaction.deleteMany(),
    testPrisma.bankAccount.deleteMany(),
    testPrisma.user.deleteMany()
  ]);
}
