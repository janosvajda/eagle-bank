import argon2 from 'argon2';

const ARGON2_MEMORY_COST_KIB = 19456;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH_BYTES = 32;

// A fixed non-user hash ensures unknown-email logins perform the same
// memory-hard verification work as existing-user logins.
const INVALID_USER_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$LVo9P1ywQTRbw7LrF2AF5Q$Pb8rHNe2usgjtunV1q8and751wtx31VtOKkoMO0GlKA';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: ARGON2_MEMORY_COST_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
  hashLength: ARGON2_HASH_LENGTH_BYTES,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(
  passwordHash: string | undefined,
  password: string,
): Promise<boolean> {
  return argon2.verify(passwordHash ?? INVALID_USER_PASSWORD_HASH, password);
}
