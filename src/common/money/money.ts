import { Prisma } from '../../generated/prisma/client.js';
import { z } from 'zod';
import { MONEY_DECIMAL_PLACES } from '../constants.js';

export const MAX_TRANSACTION_AMOUNT = 10000;

function hasSupportedDecimalPlaces(value: number): boolean {
  return new Prisma.Decimal(value).decimalPlaces() <= MONEY_DECIMAL_PLACES;
}

export const moneySchema = z
  .number()
  .finite()
  .positive()
  .max(MAX_TRANSACTION_AMOUNT)
  .refine(hasSupportedDecimalPlaces, {
    message: 'Amount must have no more than two decimal places',
  });

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(MONEY_DECIMAL_PLACES));
}

export function fromDecimal(value: Prisma.Decimal): number {
  return Number(value.toFixed(MONEY_DECIMAL_PLACES));
}
