import { describe, expect, it, vi } from 'vitest';
import { authenticate } from './authenticate.js';

describe('authenticate', () => {
  it('allows a valid JWT', async () => {
    const jwtVerify = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({
      tokenId: 'token-id',
      revokedAt: null,
      expiresAtEpoch: Math.floor(Date.now() / 1000) + 60,
    });
    await expect(
      authenticate(
        {
          jwtVerify,
          user: { sub: 'usr-owner', sid: 'session-id', jti: 'token-id' },
          server: { authSessions: { get } },
        } as never,
        {} as never,
      ),
    ).resolves.toBeUndefined();
    expect(jwtVerify).toHaveBeenCalledOnce();
  });

  it('maps JWT verification failures to 401', async () => {
    const jwtVerify = vi.fn().mockRejectedValue(new Error('invalid'));
    await expect(
      authenticate({ jwtVerify } as never, {} as never),
    ).rejects.toMatchObject({
      statusCode: 401,
      message: 'Access token is missing or invalid',
    });
  });

  it.each([
    [null],
    [{ tokenId: 'other', revokedAt: null, expiresAtEpoch: 9999999999 }],
    [{ tokenId: 'token-id', revokedAt: 'now', expiresAtEpoch: 9999999999 }],
    [{ tokenId: 'token-id', revokedAt: null, expiresAtEpoch: 0 }],
  ])('rejects an invalid backing session', async (session) => {
    await expect(
      authenticate(
        {
          jwtVerify: vi.fn().mockResolvedValue(undefined),
          user: { sub: 'usr-owner', sid: 'session-id', jti: 'token-id' },
          server: {
            authSessions: { get: vi.fn().mockResolvedValue(session) },
          },
        } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
