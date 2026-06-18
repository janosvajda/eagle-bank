import { z } from 'zod';
import { AUTH_TOKEN_TYPE_BEARER } from '../../common/auth/auth.constants.js';
import { authSessionSchema } from './auth-session.contracts.js';

export const loginResultSchema = z
  .object({
    accessToken: z.string().min(1),
    tokenType: z.literal(AUTH_TOKEN_TYPE_BEARER),
    expiresIn: z.number().int().positive(),
  })
  .strict();

export type LoginResult = z.infer<typeof loginResultSchema>;

export const authErrorResponseSchema = z
  .object({ message: z.string().min(1) })
  .passthrough();

export const passwordHashRequestSchema = z
  .object({ password: z.string().min(1) })
  .strict();

export type PasswordHashRequest = z.infer<typeof passwordHashRequestSchema>;

export const passwordHashResponseSchema = z
  .object({ passwordHash: z.string().min(1) })
  .strict();

export type PasswordHashResponse = z.infer<typeof passwordHashResponseSchema>;

export const sessionIntrospectionRequestSchema = z
  .object({
    userId: z.string().min(1),
    sessionId: z.string().min(1),
    tokenId: z.string().min(1),
  })
  .strict();

export type SessionIntrospectionRequest = z.infer<
  typeof sessionIntrospectionRequestSchema
>;

export const sessionIntrospectionResponseSchema = z
  .object({ session: authSessionSchema.nullable() })
  .strict();

export type SessionIntrospectionResponse = z.infer<
  typeof sessionIntrospectionResponseSchema
>;
