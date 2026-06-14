import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { LedgerTransactionResponse } from './ledger.contracts.js';
import { LedgerRepository } from './ledger.repository.js';

const account = {
  id: '00000000-0000-4000-8000-000000000001',
  accountId: '00000000-0000-4000-8000-000000000002',
  accountNumber: '01234567',
  userId: 1n,
  currency: 'GBP',
  availableBalance: new Prisma.Decimal('10.00'),
  status: 'ACTIVE',
  version: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as const;

function setup(updateCount = 1) {
  const transaction = {
    ledgerAccount: {
      findUnique: vi.fn().mockResolvedValue(account),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
    ledgerIdempotencyKey: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    ledgerTransaction: {
      create: vi.fn().mockResolvedValue({ id: 1n }),
    },
    ledgerEntry: { create: vi.fn().mockResolvedValue({}) },
    ledgerOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const database = {
    ledgerAccount: {
      findUnique: vi.fn().mockResolvedValue(account),
      findMany: vi.fn().mockResolvedValue([account]),
      create: vi.fn().mockResolvedValue(account),
      update: vi.fn().mockResolvedValue(account),
    },
    ledgerIdempotencyKey: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    ledgerTransaction: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(
      async (
        operation: (
          client: typeof transaction,
        ) => Promise<LedgerTransactionResponse>,
      ) => operation(transaction),
    ),
  };
  return {
    database,
    repository: new LedgerRepository(database as never),
    transaction,
  };
}

describe('LedgerRepository', () => {
  it('owns account, idempotency, and transaction queries', async () => {
    const { database, repository } = setup();

    await expect(repository.findAccount(account.accountNumber)).resolves.toBe(
      account,
    );
    await expect(
      repository.findAccounts([account.accountNumber]),
    ).resolves.toEqual([account]);
    await expect(
      repository.createAccount({
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        userId: account.userId,
        currency: 'GBP',
      }),
    ).resolves.toBe(account);
    await expect(repository.closeAccount(account.accountNumber)).resolves.toBe(
      account,
    );
    await repository.findIdempotency(
      account.userId,
      account.accountNumber,
      'request-key',
    );
    await repository.listTransactions(account.accountId);
    await repository.findTransaction(1n);

    expect(database.ledgerAccount.findMany).toHaveBeenCalledOnce();
    expect(database.ledgerIdempotencyKey.findUnique).toHaveBeenCalledOnce();
    expect(database.ledgerTransaction.findMany).toHaveBeenCalledOnce();
  });

  it.each([
    [1, true],
    [0, false],
  ])(
    'executes typed unit-of-work writes when update count is %i',
    async (updateCount, reserved) => {
      const { database, repository, transaction } = setup(updateCount);
      const response: LedgerTransactionResponse = {
        id: 'tan-1',
        amount: 1,
        currency: 'GBP',
        type: 'deposit',
        userId: 'usr-1',
        createdTimestamp: '2026-01-01T00:00:00.000Z',
      };

      await repository.runInTransaction(async (unitOfWork) => {
        await unitOfWork.findAccount(account.accountNumber);
        expect(
          await unitOfWork.reserveBalance(account, new Prisma.Decimal('11.00')),
        ).toBe(reserved);
        await unitOfWork.createIdempotency({
          idempotencyKey: 'request-key',
          userId: account.userId,
          accountNumber: account.accountNumber,
          requestHash: 'hash',
          expiresAt: new Date('2026-01-02T00:00:00.000Z'),
        });
        const created = await unitOfWork.createTransaction({
          ledgerAccountId: account.id,
          accountId: account.accountId,
          accountNumber: account.accountNumber,
          userId: account.userId,
          type: 'deposit',
          amount: new Prisma.Decimal('1.00'),
          currency: 'GBP',
        });
        await unitOfWork.createEntry({
          ledgerTransactionId: 1n,
          ledgerAccountId: account.id,
          accountId: account.accountId,
          direction: 'CREDIT',
          amount: new Prisma.Decimal('1.00'),
          currency: 'GBP',
          balanceAfter: new Prisma.Decimal('11.00'),
        });
        await unitOfWork.createOutboxEvent({
          eventId: 'event-1',
          eventType: 'TransactionPosted',
          aggregateId: account.accountNumber,
          payload: { transactionId: 'tan-1' },
        });
        await unitOfWork.completeIdempotency(
          account.userId,
          account.accountNumber,
          'request-key',
          response,
        );
        return { ...response, id: `tan-${created.id.toString()}` };
      });

      expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(transaction.ledgerEntry.create).toHaveBeenCalledOnce();
      expect(transaction.ledgerOutboxEvent.create).toHaveBeenCalledOnce();
    },
  );
});
