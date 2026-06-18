import { PrismaClient } from '../generated/prisma/client.js';
import { hashPassword } from '../src/common/password/password.js';

const prisma = new PrismaClient();

try {
  await prisma.user.upsert({
    where: { email: 'demo@eaglebank.test' },
    update: {},
    create: {
      name: 'Demo User',
      addressLine1: '1 Eagle Street',
      town: 'London',
      county: 'Greater London',
      postcode: 'SW1A 1AA',
      phoneNumber: '+447700900001',
      email: 'demo@eaglebank.test',
      passwordHash: await hashPassword('DemoPassword123!'),
    },
  });
} finally {
  await prisma.$disconnect();
}
