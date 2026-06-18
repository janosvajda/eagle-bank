import { z } from 'zod';
import { moneySchema } from '../../common/money/money.js';
import { CURRENCY_GBP, TransactionType } from '../../common/domain/banking.js';
import { accountNumberSchema } from '../accounts/accounts.schemas.js';
import { TRANSACTION_API_ID_CONTRACT_PATTERN } from './transaction-id.js';

export const transactionIdSchema = z
  .string()
  .regex(TRANSACTION_API_ID_CONTRACT_PATTERN);
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
    currency: z.literal(CURRENCY_GBP),
    type: z.enum(TransactionType),
    reference: z.string().optional(),
  })
  .strict();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
