import { Prisma } from '../../../generated/prisma/client.js';
import { z } from 'zod';
import { MONEY_DECIMAL_PLACES } from '../constants.js';
import { MAX_TRANSACTION_AMOUNT } from '../domain/banking.js';

function hasSupportedDecimalPlaces(value: number): boolean {
  return new Prisma.Decimal(value).decimalPlaces() <= MONEY_DECIMAL_PLACES;
}

export const moneySchema = z
  .number()
  .refine(Number.isFinite, { message: 'Amount must be a finite number' })
  .positive()
  .max(MAX_TRANSACTION_AMOUNT)
  .refine(hasSupportedDecimalPlaces, {
    message: 'Amount must have no more than two decimal places',
  })
  .transform(toDecimal);

export type MoneyAmount = z.infer<typeof moneySchema>;

export function toDecimal(value: number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(MONEY_DECIMAL_PLACES));
}

export function fromDecimal(value: Prisma.Decimal): number {
  return Number(value.toFixed(MONEY_DECIMAL_PLACES));
}
