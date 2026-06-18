import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password protection', () => {
  it('uses explicit Argon2id work factors and a random salt', async () => {
    const first = await hashPassword('Password123!');
    const second = await hashPassword('Password123!');

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword(first, 'Password123!')).resolves.toBe(true);
    await expect(verifyPassword(first, 'wrong')).resolves.toBe(false);
  });
});
