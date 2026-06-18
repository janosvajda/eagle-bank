import { z } from 'zod';
import {
  ACCOUNT_NUMBER_CONTRACT_PATTERN,
  ACCOUNT_TYPE_PERSONAL,
} from '../../common/domain/banking.js';

export const accountNumberSchema = z
  .string()
  .regex(ACCOUNT_NUMBER_CONTRACT_PATTERN);
export const accountParamsSchema = z.object({
  accountNumber: accountNumberSchema,
});

export const createAccountSchema = z
  .object({
    name: z.string().min(1),
    accountType: z.literal(ACCOUNT_TYPE_PERSONAL),
  })
  .strict();

export const updateAccountSchema = z
  .object({
    name: z.string().min(1).optional(),
    accountType: z.literal(ACCOUNT_TYPE_PERSONAL).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be supplied',
  });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
