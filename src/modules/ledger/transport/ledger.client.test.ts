import { afterEach, describe, expect, it, vi } from 'vitest';
import { LedgerHttpClient } from './ledger.client.js';

const accountResponse = {
  accountId: '00000000-0000-4000-8000-000000000001',
  accountNumber: '01234567',
  userId: 'usr-owner',
  currency: 'GBP',
  availableBalance: 100,
};

const transactionResponse = {
  id: 'tan-abc123',
  amount: 10,
  currency: 'GBP',
  type: 'deposit',
  userId: 'usr-owner',
  createdTimestamp: '2026-01-01T00:00:00.000Z',
};

describe('LedgerHttpClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates account, balance, and transaction responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(accountResponse)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 100 })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ balances: { '01234567': 100 } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(transactionResponse)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transactions: [transactionResponse] })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(transactionResponse)));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LedgerHttpClient(
      'http://ledger',
      'internal-secret-at-least-32-characters',
    );

    await expect(
      client.createAccount({
        accountId: accountResponse.accountId,
        accountNumber: accountResponse.accountNumber,
        userId: accountResponse.userId,
        currency: 'GBP',
      }),
    ).resolves.toEqual(accountResponse);
    await expect(client.getBalance('01234567')).resolves.toBe(100);
    await expect(client.getBalances(['01234567'])).resolves.toEqual({
      '01234567': 100,
    });
    await expect(
      client.postTransaction({
        accountNumber: '01234567',
        userId: 'usr-owner',
        amount: 10,
        currency: 'GBP',
        type: 'deposit',
      }),
    ).resolves.toEqual(transactionResponse);
    await expect(client.listTransactions('01234567')).resolves.toEqual([
      transactionResponse,
    ]);
    await expect(
      client.getTransaction('01234567', 'tan-abc123'),
    ).resolves.toEqual(transactionResponse);
  });

  it('does not declare JSON content for a bodyless close command', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(undefined, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await new LedgerHttpClient(
      'http://ledger',
      'internal-secret-at-least-32-characters',
    ).closeAccount('01000001');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers['content-type']).toBeUndefined();
    expect(headers.authorization).toMatch(/^Bearer /);
  });

  it('maps network and service failures without trusting response bodies', async () => {
    const client = new LedgerHttpClient(
      'http://ledger',
      'internal-secret-at-least-32-characters',
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(client.getBalance('01234567')).rejects.toMatchObject({
      statusCode: 503,
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: 'missing' }), {
            status: 404,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ invalid: true }), { status: 409 }),
        ),
    );
    await expect(client.getBalance('01234567')).rejects.toMatchObject({
      statusCode: 404,
      message: 'missing',
    });
    await expect(client.getBalance('01234567')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Ledger request failed',
    });
  });

  it('rejects contract-invalid successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ balance: '100' }))),
    );
    const client = new LedgerHttpClient(
      'http://ledger',
      'internal-secret-at-least-32-characters',
    );
    await expect(client.getBalance('01234567')).rejects.toThrow();
  });
});
