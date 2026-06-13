import { z } from 'zod';
import { moneySchema } from '../../common/money/money.js';
import { Currency, TransactionType } from '../../common/domain/banking.js';
import { accountNumberSchema } from '../accounts/accounts.schemas.js';

export const transactionIdSchema = z.string().regex(/^tan-[A-Za-z0-9]+$/);
export const transactionAccountParamsSchema = z.object({
  accountNumber: accountNumberSchema,
});
export const transactionParamsSchema = z.object({
  accountNumber: accountNumberSchema,
  transactionId: transactionIdSchema,
});

export const createTransactionSchema = z
  .object({
    amount: moneySchema,
    currency: z.literal(Currency.GBP),
    type: z.enum(TransactionType),
    reference: z.string().optional(),
  })
  .strict();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
