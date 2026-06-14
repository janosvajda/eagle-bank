import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerHttpSecurity } from './http-security.js';

describe('HTTP security policy', () => {
  it('adds defensive headers without advertising HSTS over local HTTP', async () => {
    const app = fastify();
    registerHttpSecurity(app, 'local');
    app.get('/', async () => ({ ok: true }));

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'permissions-policy': 'camera=(), geolocation=(), microphone=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    expect(response.headers).not.toHaveProperty('strict-transport-security');
    await app.close();
  });

  it('adds HSTS in an AWS deployment environment', async () => {
    const app = fastify();
    registerHttpSecurity(app, 'prod');
    app.get('/', async () => ({ ok: true }));

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
    await app.close();
  });
});
