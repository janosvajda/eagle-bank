import { z } from 'zod';

export const authSessionSchema = z
  .object({
    userId: z.string().min(1),
    sessionId: z.string().min(1),
    tokenId: z.string().min(1),
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    expiresAtEpoch: z.number().int().positive(),
    revokedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strip();

export type AuthSession = z.infer<typeof authSessionSchema>;

export interface AuthSessionStore {
  create(userId: string, ttlSeconds: number): Promise<AuthSession>;
  get(
    userId: string,
    sessionId: string,
    tokenId?: string,
  ): Promise<AuthSession | null>;
}
