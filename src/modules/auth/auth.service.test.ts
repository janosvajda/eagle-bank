import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsersRepository } from '../users/users.repository.js';
import { AuthService } from './auth.service.js';
import type { AuthSessionStore } from './auth-session.contracts.js';
import { verifyPassword } from '../../common/password/password.js';

vi.mock('../../common/password/password.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../common/password/password.js')>();
  return {
    ...actual,
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

describe('AuthService', () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash('Password123!');
  });

  beforeEach(() => {
    vi.mocked(verifyPassword).mockClear();
  });

  function service(user: { id: bigint; passwordHash: string } | null) {
    const users = { findByEmail: vi.fn().mockResolvedValue(user) };
    const sign = vi.fn().mockReturnValue('signed-token');
    const info = vi.fn();
    const warn = vi.fn();
    const app = { jwt: { sign }, log: { info, warn } };
    const sessions = {
      create: vi.fn().mockResolvedValue({
        sessionId: 'session-id',
        tokenId: 'token-id',
      }),
    };
    return {
      users,
      sign,
      info,
      sessions,
      auth: new AuthService(
        users as unknown as UsersRepository,
        app as unknown as FastifyInstance,
        '1h',
        sessions as unknown as AuthSessionStore,
        3600,
      ),
    };
  }

  it('signs a JWT for valid credentials', async () => {
    const { auth, sign, info } = service({
      id: 1n,
      passwordHash,
    });
    await expect(
      auth.login({ email: 'owner@example.com', password: 'Password123!' }),
    ).resolves.toEqual({
      accessToken: 'signed-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(sign).toHaveBeenCalledWith(
      { sub: 'usr-1', sid: 'session-id', jti: 'token-id' },
      { expiresIn: '1h' },
    );
    expect(info).toHaveBeenCalledWith(
      { sessionId: 'session-id', userId: 'usr-1' },
      'Authentication session created',
    );
  });

  it('rejects a wrong password', async () => {
    const { auth, sign } = service({
      id: 1n,
      passwordHash,
    });
    await expect(
      auth.login({ email: 'owner@example.com', password: 'wrong' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects a missing user', async () => {
    const { auth } = service(null);
    await expect(
      auth.login({ email: 'missing@example.com', password: 'Password123!' }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(verifyPassword).not.toHaveBeenCalled();
  });
});
