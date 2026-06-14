import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app.js';
import { authorization, tokenFor } from '../helpers/auth.js';
import { resetDatabase, testPrisma } from '../helpers/database.js';
import { createAccount, createUser } from '../helpers/factories.js';

function expectError(
  response: LightMyRequestResponse,
  statusCode: number,
  message: string,
): void {
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toMatchObject({ message });
}

describe('assessment error responses', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
  });

  it('returns the required authentication and validation messages', async () => {
    expectError(
      await app.inject({ method: 'GET', url: '/v1/accounts' }),
      401,
      'Access token is missing or invalid',
    );

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/users',
      payload: {},
    });
    expectError(invalid, 400, 'Invalid details supplied');
    expect(invalid.json().details).toEqual(expect.any(Array));
  });

  it('returns the required user authorization, lookup, and conflict messages', async () => {
    const own = await createUser();
    const other = await createUser({
      email: 'other@example.com',
      phoneNumber: '+447700900002',
    });
    const headers = authorization(tokenFor(app, own.publicId));

    expectError(
      await app.inject({
        method: 'GET',
        url: `/v1/users/${other.publicId}`,
        headers,
      }),
      403,
      'You are not allowed to access this user',
    );
    expectError(
      await app.inject({
        method: 'GET',
        url: '/v1/users/usr-abc123',
        headers,
      }),
      404,
      'User was not found',
    );

    await createAccount(own.publicId);
    expectError(
      await app.inject({
        method: 'DELETE',
        url: `/v1/users/${own.publicId}`,
        headers,
      }),
      409,
      'A user cannot be deleted while associated with a bank account',
    );
  });

  it('returns the required account and transaction messages', async () => {
    const own = await createUser();
    const other = await createUser({
      email: 'other@example.com',
      phoneNumber: '+447700900002',
    });
    await createAccount(own.publicId, '01111111');
    await createAccount(other.publicId, '01222222');
    const headers = authorization(tokenFor(app, own.publicId));

    expectError(
      await app.inject({
        method: 'GET',
        url: '/v1/accounts/01222222',
        headers,
      }),
      403,
      'You are not allowed to access this bank account',
    );
    expectError(
      await app.inject({
        method: 'GET',
        url: '/v1/accounts/01999999',
        headers,
      }),
      404,
      'Bank account was not found',
    );
    expectError(
      await app.inject({
        method: 'POST',
        url: '/v1/accounts/01111111/transactions',
        headers,
        payload: { amount: 1, currency: 'GBP', type: 'withdrawal' },
      }),
      422,
      'Insufficient funds to process transaction',
    );
    expectError(
      await app.inject({
        method: 'GET',
        url: '/v1/accounts/01111111/transactions/tan-abc123',
        headers,
      }),
      404,
      'Transaction was not found',
    );
  });
});
