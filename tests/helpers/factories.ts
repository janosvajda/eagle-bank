import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { testPrisma } from './database.js';

export const userPayload = {
  name: 'Test User',
  address: {
    line1: '1 Test Road',
    town: 'London',
    county: 'Greater London',
    postcode: 'SW1A 1AA',
  },
  phoneNumber: '+447700900001',
  email: 'test@example.com',
  password: 'Password123!',
};

export async function createUser(overrides: Partial<typeof userPayload> = {}) {
  const payload = {
    ...userPayload,
    ...overrides,
    address: { ...userPayload.address, ...(overrides.address ?? {}) },
  };
  return testPrisma.user.create({
    data: {
      id: `usr-${randomUUID().replaceAll('-', '')}`,
      name: payload.name,
      addressLine1: payload.address.line1,
      town: payload.address.town,
      county: payload.address.county,
      postcode: payload.address.postcode,
      phoneNumber: payload.phoneNumber,
      email: payload.email,
      passwordHash: await argon2.hash(payload.password),
    },
  });
}

export async function createAccount(
  userId: string,
  accountNumber = '01234567',
) {
  return testPrisma.bankAccount.create({
    data: {
      accountNumber,
      name: 'Personal Bank Account',
      accountType: 'personal',
      userId,
      status: 'ACTIVE',
      ledgerAccount: {
        create: {
          accountNumber,
          userId,
          currency: 'GBP',
        },
      },
    },
  });
}
