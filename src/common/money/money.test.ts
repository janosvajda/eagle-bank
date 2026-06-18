import { Prisma } from '../../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import { fromDecimal, moneySchema, toDecimal } from './money.js';
import {
  accountNumberSchema,
  updateAccountSchema,
} from '../../modules/accounts/accounts.schemas.js';
import { createTransactionSchema } from '../../modules/transactions/transactions.schemas.js';
import {
  createUserSchema,
  updateUserSchema,
} from '../../modules/users/users.schemas.js';
import { MAX_TRANSACTION_AMOUNT } from '../domain/banking.js';

describe('money handling', () => {
  it.each([
    0.01,
    0.1,
    0.2,
    0.89,
    1.13,
    1.22,
    2.12,
    4.29,
    10.99,
    MAX_TRANSACTION_AMOUNT,
  ])('accepts valid amount %s', (amount) => {
    expect(moneySchema.parse(amount)).toEqual(toDecimal(amount));
  });

  it.each([
    0,
    -1,
    MAX_TRANSACTION_AMOUNT + 0.01,
    1.001,
    10.999,
    Number.NaN,
    Infinity,
    -Infinity,
  ])('rejects invalid amount %s', (amount) => {
    expect(() => moneySchema.parse(amount)).toThrow();
  });

  it('converts money without binary floating-point output', () => {
    const decimal = toDecimal(10.1);
    expect(decimal).toEqual(new Prisma.Decimal('10.10'));
    expect(fromDecimal(decimal)).toBe(10.1);
  });

  it('keeps minor-unit arithmetic exact with Decimal values', () => {
    const total = toDecimal(0.1).add(toDecimal(0.2));

    expect(total).toEqual(new Prisma.Decimal('0.30'));
    expect(fromDecimal(total)).toBe(0.3);
  });

  it('keeps representative two-decimal amounts exact', () => {
    const total = toDecimal(1.22).add(toDecimal(0.89)).add(toDecimal(2.12));

    expect(total).toEqual(new Prisma.Decimal('4.23'));
    expect(fromDecimal(total)).toBe(4.23);
  });
});

describe('request schemas', () => {
  const validUser = {
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

  it('accepts a contract-compliant user and rejects unknown fields', () => {
    expect(createUserSchema.parse(validUser)).toEqual(validUser);
    expect(() =>
      createUserSchema.parse({ ...validUser, administrator: true }),
    ).toThrow();
  });

  it('rejects empty PATCH bodies', () => {
    expect(() => updateUserSchema.parse({})).toThrow();
    expect(() => updateAccountSchema.parse({})).toThrow();
  });

  it('validates account numbers', () => {
    expect(accountNumberSchema.parse('01234567')).toBe('01234567');
    expect(() => accountNumberSchema.parse('12345678')).toThrow();
  });

  it('enforces transaction currency, type, and precision', () => {
    expect(
      createTransactionSchema.parse({
        amount: 12.34,
        currency: 'GBP',
        type: 'deposit',
      }),
    ).toMatchObject({
      amount: new Prisma.Decimal('12.34'),
      currency: 'GBP',
      type: 'deposit',
    });

    expect(() =>
      createTransactionSchema.parse({
        amount: 12.345,
        currency: 'GBP',
        type: 'deposit',
      }),
    ).toThrow();
    expect(() =>
      createTransactionSchema.parse({
        amount: 12,
        currency: 'USD',
        type: 'deposit',
      }),
    ).toThrow();
  });
});
