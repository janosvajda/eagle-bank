import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthHttpClient, RemoteAuthSessionStore } from './auth.client.js';

describe('AuthHttpClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('supports login, hashing, and introspection', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'token',
            tokenType: 'Bearer',
            expiresIn: 3600,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ passwordHash: 'hash' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ session: null })));
    vi.stubGlobal('fetch', fetch);
    const client = new AuthHttpClient('http://auth', 'secret-secret-secret');
    await expect(
      client.login({ email: 'a@b.com', password: 'password' }),
    ).resolves.toMatchObject({ accessToken: 'token' });
    await expect(client.hash('password')).resolves.toBe('hash');
    await expect(client.introspect('u', 's', 't')).resolves.toBeNull();
    expect(fetch.mock.calls[0]![1].headers.authorization).toBeUndefined();
    expect(fetch.mock.calls[1]![1].headers.authorization).toMatch(/^Bearer /);
  });

  it('maps unavailable and failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = new AuthHttpClient('http://auth', 'secret-secret-secret');
    await expect(client.hash('password')).rejects.toMatchObject({
      statusCode: 503,
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'denied' }), { status: 401 }),
        ),
    );
    await expect(client.hash('password')).rejects.toMatchObject({
      statusCode: 401,
      message: 'denied',
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ invalid: true }), { status: 500 }),
        ),
    );
    await expect(client.hash('password')).rejects.toMatchObject({
      statusCode: 500,
      message: 'Authentication request failed',
    });
  });

  it('rejects contract-invalid successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ accessToken: 'token' })),
        ),
    );
    const client = new AuthHttpClient('http://auth', 'secret-secret-secret');
    await expect(
      client.login({ email: 'a@b.com', password: 'password' }),
    ).rejects.toThrow();
  });

  it('adapts remote session lookup', async () => {
    const client = { introspect: vi.fn().mockResolvedValue(null) };
    const store = new RemoteAuthSessionStore(client as never);
    await expect(store.get('u', 's')).resolves.toBeNull();
    expect(client.introspect).toHaveBeenCalledWith('u', 's', '');
  });
});
