import { describe, expect, it, vi } from 'vitest';
import { createInternalServiceToken } from '../common/auth/internal-service-jwt.js';
import { buildLedgerApp } from './ledger-app.js';

const ledger = vi.hoisted(() => ({
  closeAccount: vi.fn().mockResolvedValue(undefined),
  createAccount: vi.fn().mockResolvedValue({
    accountNumber: '01234567',
    userId: 'usr-owner',
  }),
  postTransaction: vi.fn().mockResolvedValue({
    id: 'tan-abc123',
    type: 'deposit',
    userId: 'usr-owner',
  }),
}));

vi.mock('../modules/ledger/ledger.service.js', () => ({
  LedgerService: class {
    closeAccount = ledger.closeAccount;
    createAccount = ledger.createAccount;
    postTransaction = ledger.postTransaction;
  },
}));

const internalSecret = 'internal-secret-that-is-at-least-32-characters';

function authorization(): string {
  const token = createInternalServiceToken({
    issuer: 'api',
    audience: 'ledger-service',
    secret: internalSecret,
  });
  return `Bearer ${token}`;
}

describe('buildLedgerApp logging', () => {
  it('warns when an internal request is not authenticated', async () => {
    const app = await buildLedgerApp({
      prisma: {} as never,
      internalSecret,
    });
    const warnLog = vi.spyOn(app.log, 'warn');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/ledger/accounts/01234567/close',
    });

    expect(response.statusCode).toBe(401);
    expect(warnLog).toHaveBeenCalledWith(
      {
        method: 'POST',
        path: '/internal/ledger/accounts/01234567/close',
      },
      'Internal Ledger request rejected',
    );
    await app.close();
  });

  it('records account and transaction mutations', async () => {
    const app = await buildLedgerApp({
      prisma: {} as never,
      internalSecret,
    });
    const infoLog = vi.spyOn(app.log, 'info');
    const headers = { authorization: authorization() };

    const created = await app.inject({
      method: 'POST',
      url: '/internal/ledger/accounts',
      headers,
      payload: {
        accountId: '9da84f41-97b0-4e74-b95d-3f7665e64e7c',
        accountNumber: '01234567',
        currency: 'GBP',
        userId: 'usr-owner',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(infoLog).toHaveBeenCalledWith(
      { accountNumber: '01234567', userId: 'usr-owner' },
      'Ledger account created',
    );

    const transaction = await app.inject({
      method: 'POST',
      url: '/internal/ledger/accounts/01234567/transactions',
      headers,
      payload: {
        accountNumber: '01234567',
        amount: 10,
        currency: 'GBP',
        type: 'deposit',
        userId: 'usr-owner',
      },
    });
    expect(transaction.statusCode).toBe(201);
    expect(infoLog).toHaveBeenCalledWith(
      {
        accountNumber: '01234567',
        transactionId: 'tan-abc123',
        transactionType: 'deposit',
        userId: 'usr-owner',
      },
      'Ledger transaction posted',
    );

    const closed = await app.inject({
      method: 'POST',
      url: '/internal/ledger/accounts/01234567/close',
      headers,
    });
    expect(closed.statusCode).toBe(204);
    expect(infoLog).toHaveBeenCalledWith(
      { accountNumber: '01234567' },
      'Ledger account closed',
    );
    await app.close();
  });
});
