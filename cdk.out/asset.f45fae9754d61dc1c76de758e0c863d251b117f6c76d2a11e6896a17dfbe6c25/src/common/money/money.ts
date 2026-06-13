import { Prisma } from "@prisma/client";
import { z } from "zod";

export const moneySchema = z
  .number()
  .finite()
  .positive()
  .max(10_000)
  .refine((value) => Number.isInteger(value * 100), {
    message: "Amount must have no more than two decimal places"
  });

export function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function fromDecimal(value: Prisma.Decimal): number {
  return Number(value.toFixed(2));
}
