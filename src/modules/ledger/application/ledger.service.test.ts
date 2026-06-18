import {
  Prisma,
  type LedgerAccount,
  type LedgerTransaction,
} from '../../../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { PostLedgerTransactionCommand } from '../domain/ledger.contracts.js';
import { LedgerRepository } from '../persistence/ledger.repository.js';
import { LedgerService } from './ledger.service.js';
import { PrismaErrorCode } from '../../../common/errors/prisma-error-codes.js';

const createdAt = new Date('2026-01-01T12:00:00.000Z');

function account(overrides: Partial<LedgerAccount> = {}): LedgerAccount {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    accountId: '00000000-0000-4000-8000-000000000002',
    accountNumber: '01234567',
    userId: 1n,
    currency: 'GBP',
    availableBalance: new Prisma.Decimal('100.00'),
    status: 'ACTIVE',
    version: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function transaction(
  overrides: Partial<LedgerTransaction> = {},
): LedgerTransaction {
  return {
    id: 3n,
    ledgerAccountId: account().id,
    accountId: account().accountId,
    accountNumber: account().accountNumber,
    userId: 1n,
    type: 'deposit',
    amount: new Prisma.Decimal('25.50'),
    currency: 'GBP',
    reference: 'Savings',
    status: 'POSTED',
    idempotencyKey: null,
    createdAt,
    ...overrides,
  };
}

function command(
  overrides: Partial<PostLedgerTransactionCommand> = {},
): PostLedgerTransactionCommand {
  return {
    accountNumber: account().accountNumber,
    userId: 'usr-1',
    type: 'deposit',
    amount: new Prisma.Decimal('25.50'),
    currency: 'GBP',
    ...overrides,
  };
}

function database(
  options: {
    foundAccount?: LedgerAccount | null;
    createdTransaction?: LedgerTransaction;
    previousIdempotency?: unknown;
  } = {},
) {
  const foundAccount =
    options.foundAccount === undefined ? account() : options.foundAccount;
  const createdTransaction = options.createdTransaction ?? transaction();
  const tx = {
    ledgerAccount: {
      findUnique: vi.fn().mockResolvedValue(foundAccount),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(foundAccount),
    },
    ledgerIdempotencyKey: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    ledgerTransaction: {
      create: vi.fn().mockResolvedValue(createdTransaction),
    },
    ledgerEntry: {
      create: vi.fn().mockResolvedValue({}),
    },
    ledgerOutboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const db = {
    ledgerAccount: {
      findUnique: vi.fn().mockResolvedValue(foundAccount),
      findMany: vi.fn().mockResolvedValue(foundAccount ? [foundAccount] : []),
      create: vi.fn().mockResolvedValue(account()),
      update: vi.fn().mockResolvedValue(foundAccount),
    },
    ledgerIdempotencyKey: {
      findUnique: vi
        .fn()
        .mockResolvedValue(options.previousIdempotency ?? null),
    },
    ledgerTransaction: {
      findMany: vi.fn().mockResolvedValue([createdTransaction]),
      findUnique: vi.fn().mockResolvedValue(createdTransaction),
    },
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
  return {
    db,
    tx,
    service: new LedgerService(new LedgerRepository(db as never)),
  };
}

describe('LedgerService account lifecycle', () => {
  it('rejects account creation with an invalid user API ID', async () => {
    const { service } = database({ foundAccount: null });

    await expect(
      service.createAccount({
        accountId: account().accountId,
        accountNumber: account().accountNumber,
        userId: 'usr-invalid',
        currency: 'GBP',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('creates a new ledger account', async () => {
    const { db, service } = database({ foundAccount: null });
    const input = {
      accountId: account().accountId,
      accountNumber: account().accountNumber,
      userId: 'usr-1',
      currency: 'GBP' as const,
    };
    await service.createAccount(input);
    expect(db.ledgerAccount.create).toHaveBeenCalledWith({
      data: { ...input, userId: 1n },
    });
  });

  it('returns an identical existing account idempotently', async () => {
    const existing = account();
    const { db, service } = database({ foundAccount: existing });
    await expect(
      service.createAccount({
        accountId: existing.accountId,
        accountNumber: existing.accountNumber,
        userId: 'usr-1',
        currency: 'GBP',
      }),
    ).resolves.toEqual({
      accountId: existing.accountId,
      accountNumber: existing.accountNumber,
      userId: 'usr-1',
      currency: 'GBP',
      availableBalance: 100,
    });
    expect(db.ledgerAccount.create).not.toHaveBeenCalled();
  });

  it.each([
    { accountId: '00000000-0000-4000-8000-000000000099' },
    { userId: 2n },
    { currency: 'USD' },
  ])('rejects conflicting existing account data: %o', async (change) => {
    const existing = account(change as Partial<LedgerAccount>);
    const { service } = database({ foundAccount: existing });
    await expect(
      service.createAccount({
        accountId: account().accountId,
        accountNumber: account().accountNumber,
        userId: 'usr-1',
        currency: 'GBP',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('gets one balance and a batch of balances', async () => {
    const second = account({
      id: '00000000-0000-4000-8000-000000000004',
      accountId: '00000000-0000-4000-8000-000000000005',
      accountNumber: '01234568',
      availableBalance: new Prisma.Decimal('7.10'),
    });
    const { db, service } = database();
    db.ledgerAccount.findMany.mockResolvedValue([account(), second]);
    await expect(service.getBalance('01234567')).resolves.toBe(100);
    await expect(service.getBalances([])).resolves.toEqual({});
    await expect(
      service.getBalances(['01234567', '01234568']),
    ).resolves.toEqual({ '01234567': 100, '01234568': 7.1 });
  });

  it('rejects an incomplete batch balance projection', async () => {
    const { service } = database();
    await expect(
      service.getBalances(['01234567', '01234568']),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('closes active accounts and treats closed accounts idempotently', async () => {
    const active = database();
    await active.service.closeAccount('01234567');
    expect(active.db.ledgerAccount.update).toHaveBeenCalledWith({
      where: { accountNumber: '01234567' },
      data: { status: 'CLOSED', version: { increment: 1 } },
    });

    const closed = database({ foundAccount: account({ status: 'CLOSED' }) });
    await closed.service.closeAccount('01234567');
    expect(closed.db.ledgerAccount.update).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive accounts', async () => {
    await expect(
      database({ foundAccount: null }).service.closeAccount('01234567'),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      database({ foundAccount: null }).service.getBalance('01234567'),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      database({
        foundAccount: account({ status: 'CLOSED' }),
      }).service.getBalance('01234567'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('LedgerService transactions', () => {
  it('rejects transaction creation with an invalid user API ID', async () => {
    const { service } = database();

    await expect(
      service.postTransaction(command({ userId: 'usr-invalid' })),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('posts a deposit with ledger entry, balance update, and outbox event', async () => {
    const posted = transaction();
    const { db, tx, service } = database({ createdTransaction: posted });
    const result = await service.postTransaction(
      command({
        reference: 'Savings',
        requestId: 'request-1',
        correlationId: 'correlation-1',
      }),
    );

    expect(result).toEqual({
      id: 'tan-3',
      amount: 25.5,
      currency: 'GBP',
      type: 'deposit',
      reference: 'Savings',
      userId: 'usr-1',
      createdTimestamp: createdAt.toISOString(),
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'CREDIT',
        balanceAfter: new Prisma.Decimal('125.50'),
      }),
    });
    expect(tx.ledgerAccount.updateMany).toHaveBeenCalledWith({
      where: {
        id: account().id,
        status: 'ACTIVE',
        version: account().version,
      },
      data: {
        availableBalance: new Prisma.Decimal('125.50'),
        version: { increment: 1 },
      },
    });
    expect(tx.ledgerOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'TransactionPosted',
        aggregateId: '01234567',
        payload: expect.objectContaining({
          amount: '25.50',
          balanceAfter: '125.50',
          reference: 'Savings',
          requestId: 'request-1',
          correlationId: 'correlation-1',
        }),
      }),
    });
  });

  it('posts minor-unit decimal amounts without floating-point drift', async () => {
    const posted = transaction({
      amount: new Prisma.Decimal('1.22'),
    });
    const { tx, service } = database({
      createdTransaction: posted,
      foundAccount: account({
        availableBalance: new Prisma.Decimal('0.89'),
      }),
    });
    const result = await service.postTransaction(
      command({ amount: new Prisma.Decimal('1.22') }),
    );

    expect(result).toMatchObject({ amount: 1.22 });
    expect(tx.ledgerAccount.updateMany).toHaveBeenCalledWith({
      where: {
        id: account().id,
        status: 'ACTIVE',
        version: account().version,
      },
      data: {
        availableBalance: new Prisma.Decimal('2.11'),
        version: { increment: 1 },
      },
    });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: new Prisma.Decimal('1.22'),
        balanceAfter: new Prisma.Decimal('2.11'),
      }),
    });
    expect(tx.ledgerOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          amount: '1.22',
          balanceAfter: '2.11',
        }),
      }),
    });
  });

  it('posts an idempotent withdrawal and records completion', async () => {
    const posted = transaction({
      type: 'withdrawal',
      amount: new Prisma.Decimal('20.00'),
      reference: null,
      idempotencyKey: 'key-1',
    });
    const { tx, service } = database({ createdTransaction: posted });
    const result = await service.postTransaction(
      command({
        type: 'withdrawal',
        amount: new Prisma.Decimal('20.00'),
        idempotencyKey: 'key-1',
      }),
    );
    expect(result).not.toHaveProperty('reference');
    expect(tx.ledgerIdempotencyKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'key-1',
        requestHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'DEBIT',
        balanceAfter: new Prisma.Decimal('80.00'),
      }),
    });
    expect(tx.ledgerIdempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          responsePayload: result,
        }),
      }),
    );
    expect(tx.ledgerOutboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          reference: null,
          requestId: null,
          correlationId: null,
        }),
      }),
    });
  });

  it('returns a completed idempotent response without starting a transaction', async () => {
    const response = {
      id: 'tan-replayed',
      amount: 25.5,
      currency: 'GBP',
      type: 'deposit' as const,
      userId: 'usr-1',
      createdTimestamp: createdAt.toISOString(),
    };
    const hashSource = database();
    await hashSource.service.postTransaction(
      command({ idempotencyKey: 'key-1' }),
    );
    const requestHash =
      hashSource.tx.ledgerIdempotencyKey.create.mock.calls[0]![0].data
        .requestHash;
    const { db, service } = database({
      previousIdempotency: { requestHash, responsePayload: response },
    });
    await expect(
      service.postTransaction(command({ idempotencyKey: 'key-1' })),
    ).resolves.toEqual(response);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for different input', async () => {
    const { db, service } = database({
      previousIdempotency: {
        requestHash: 'different',
        responsePayload: { id: 'old' },
      },
    });
    await expect(
      service.postTransaction(command({ idempotencyKey: 'key-1' })),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an idempotency record that is still processing', async () => {
    const hashSource = database();
    await hashSource.service.postTransaction(
      command({ idempotencyKey: 'key-1' }),
    );
    const requestHash =
      hashSource.tx.ledgerIdempotencyKey.create.mock.calls[0]![0].data
        .requestHash;
    const pending = database({
      previousIdempotency: { requestHash, responsePayload: null },
    });
    await expect(
      pending.service.postTransaction(command({ idempotencyKey: 'key-1' })),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(pending.db.$transaction).not.toHaveBeenCalled();
  });

  it('replays a completed idempotent response after a duplicate-key race', async () => {
    const response = {
      id: 'tan-replayed',
      amount: 25.5,
      currency: 'GBP',
      type: 'deposit' as const,
      userId: 'usr-1',
      createdTimestamp: createdAt.toISOString(),
    };
    const hashSource = database();
    await hashSource.service.postTransaction(
      command({ idempotencyKey: 'key-1' }),
    );
    const requestHash =
      hashSource.tx.ledgerIdempotencyKey.create.mock.calls[0]![0].data
        .requestHash;
    const duplicateKeyError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        clientVersion: 'test',
        code: PrismaErrorCode.UNIQUE_CONSTRAINT,
      },
    );
    const raced = database();
    raced.db.ledgerIdempotencyKey.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ requestHash, responsePayload: response });
    raced.tx.ledgerIdempotencyKey.create.mockRejectedValueOnce(
      duplicateKeyError,
    );

    await expect(
      raced.service.postTransaction(command({ idempotencyKey: 'key-1' })),
    ).resolves.toEqual(response);
    expect(raced.db.ledgerIdempotencyKey.findUnique).toHaveBeenCalledTimes(2);
    expect(raced.tx.ledgerTransaction.create).not.toHaveBeenCalled();
  });

  it('returns service unavailable when a duplicate-key race cannot be replayed yet', async () => {
    const duplicateKeyError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        clientVersion: 'test',
        code: PrismaErrorCode.UNIQUE_CONSTRAINT,
      },
    );
    const raced = database();
    raced.db.ledgerIdempotencyKey.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    raced.tx.ledgerIdempotencyKey.create.mockRejectedValueOnce(
      duplicateKeyError,
    );

    await expect(
      raced.service.postTransaction(command({ idempotencyKey: 'key-1' })),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(raced.db.ledgerIdempotencyKey.findUnique).toHaveBeenCalledTimes(2);
    expect(raced.tx.ledgerTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects transactions for missing and closed accounts', async () => {
    await expect(
      database({ foundAccount: null }).service.postTransaction(command()),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      database({
        foundAccount: account({ status: 'CLOSED' }),
      }).service.postTransaction(command()),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      database({
        foundAccount: account({ userId: 2n }),
      }).service.postTransaction(command()),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      database({
        foundAccount: account({ currency: 'USD' }),
      }).service.postTransaction(command()),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('enforces insufficient-funds and maximum-balance limits', async () => {
    await expect(
      database().service.postTransaction(
        command({ type: 'withdrawal', amount: new Prisma.Decimal('100.01') }),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: 'INSUFFICIENT_FUNDS' });

    await expect(
      database({
        foundAccount: account({
          availableBalance: new Prisma.Decimal('9990.00'),
        }),
      }).service.postTransaction(
        command({ amount: new Prisma.Decimal('10.01') }),
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'BALANCE_LIMIT_EXCEEDED',
    });
  });

  it('retries optimistic balance conflicts and succeeds', async () => {
    const { db, service, tx } = database();
    tx.ledgerAccount.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(service.postTransaction(command())).resolves.toMatchObject({
      id: 'tan-3',
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('returns service unavailable when balance conflicts persist', async () => {
    const { db, service, tx } = database();
    tx.ledgerAccount.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.postTransaction(command())).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not reinterpret non-concurrency persistence failures', async () => {
    const persistenceError = new Error('database unavailable');
    const { service, tx } = database();
    tx.ledgerTransaction.create.mockRejectedValue(persistenceError);

    await expect(service.postTransaction(command())).rejects.toBe(
      persistenceError,
    );
  });

  it('lists transactions in account order and maps optional references', async () => {
    const { db, service } = database();
    db.ledgerTransaction.findMany.mockResolvedValue([
      transaction(),
      transaction({
        id: 4n,
        reference: null,
      }),
    ]);
    await expect(service.listTransactions('01234567')).resolves.toEqual([
      expect.objectContaining({ reference: 'Savings' }),
      expect.not.objectContaining({ reference: expect.anything() }),
    ]);
    expect(db.ledgerTransaction.findMany).toHaveBeenCalledWith({
      where: { accountId: account().accountId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('gets only transactions belonging to the requested account', async () => {
    const valid = database();
    await expect(
      valid.service.getTransaction('01234567', 'tan-3'),
    ).resolves.toMatchObject({ id: 'tan-3' });

    const missing = database();
    missing.db.ledgerTransaction.findUnique.mockResolvedValue(null);
    await expect(
      missing.service.getTransaction('01234567', 'tan-999'),
    ).rejects.toMatchObject({ statusCode: 404 });

    const foreign = database({
      createdTransaction: transaction({
        ledgerAccountId: '00000000-0000-4000-8000-000000000099',
      }),
    });
    await expect(
      foreign.service.getTransaction('01234567', 'tan-3'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
