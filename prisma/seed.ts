import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

try {
  await prisma.user.upsert({
    where: { email: "demo@eaglebank.test" },
    update: {},
    create: {
      id: "usr-demo",
      name: "Demo User",
      addressLine1: "1 Eagle Street",
      town: "London",
      county: "Greater London",
      postcode: "SW1A 1AA",
      phoneNumber: "+447700900001",
      email: "demo@eaglebank.test",
      passwordHash: await argon2.hash("DemoPassword123!"),
    },
  });
} finally {
  await prisma.$disconnect();
}
