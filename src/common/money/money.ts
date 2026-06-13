import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { MONEY_DECIMAL_PLACES } from '../constants.js';

export const MAX_TRANSACTION_AMOUNT = 10000;
const MINOR_UNITS_PER_MAJOR_UNIT = 100;

export const moneySchema = z
  .number()
  .finite()
  .positive()
  .max(MAX_TRANSACTION_AMOUNT)
  .refine((value) => Number.isInteger(value * MINOR_UNITS_PER_MAJOR_UNIT), {
    message: 'Amount must have no more than two decimal places',
  });

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(MONEY_DECIMAL_PLACES));
}

export function fromDecimal(value: Prisma.Decimal): number {
  return Number(value.toFixed(MONEY_DECIMAL_PLACES));
}
