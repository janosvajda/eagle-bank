import { z } from "zod";

const MINIMUM_PASSWORD_LENGTH = 8;
const MAXIMUM_PASSWORD_LENGTH = 128;

export const userIdSchema = z.string().regex(/^usr-[A-Za-z0-9]+$/);

export const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().min(1).optional(),
  line3: z.string().min(1).optional(),
  town: z.string().min(1),
  county: z.string().min(1),
  postcode: z.string().min(1),
});

export const createUserSchema = z
  .object({
    name: z.string().min(1),
    address: addressSchema,
    phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/),
    email: z.email(),
    password: z
      .string()
      .min(MINIMUM_PASSWORD_LENGTH)
      .max(MAXIMUM_PASSWORD_LENGTH),
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: z.string().min(1).optional(),
    address: addressSchema.optional(),
    phoneNumber: z
      .string()
      .regex(/^\+[1-9]\d{1,14}$/)
      .optional(),
    email: z.email().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be supplied",
  });

export const userParamsSchema = z.object({ userId: userIdSchema });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
