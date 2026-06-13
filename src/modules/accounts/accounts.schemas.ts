import { z } from "zod";

export const accountNumberSchema = z.string().regex(/^01\d{6}$/);
export const accountParamsSchema = z.object({
  accountNumber: accountNumberSchema,
});

export const createAccountSchema = z
  .object({
    name: z.string().min(1),
    accountType: z.literal("personal"),
  })
  .strict();

export const updateAccountSchema = z
  .object({
    name: z.string().min(1).optional(),
    accountType: z.literal("personal").optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be supplied",
  });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
