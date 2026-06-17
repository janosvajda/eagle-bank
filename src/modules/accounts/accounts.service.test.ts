import { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/AppError.js';
import { PrismaErrorCode } from '../../common/errors/prisma-error-codes.js';
import type { AccountsRepository } from './accounts.repository.js';
import type { BankAccountWithOwner } from './accounts.repository.js';
import { AccountsService } from './accounts.service.js';
import type { LedgerGateway } from '../ledger/domain/ledger.contracts.js';

const ownerId = 'usr-1';
const account: BankAccountWithOwner = {
  id: '00000000-0000-4000-8000-000000000001',
  accountNumber: '01234567',
  sortCode: '10-10-10',
  name: 'Personal',
  accountType: 'personal',
  balance: new Prisma.Decimal('0.00'),
  currency: 'GBP',
  userId: 1n,
  user: { id: 1n },
  status: 'ACTIVE',
  deletedAt: null,
  reconciliationCorrelationId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function setup(found: BankAccountWithOwner | null = account) {
  const repository = {
    create: vi.fn().mockResolvedValue(account),
    listByUser: vi.fn().mockResolvedValue([account]),
    findByNumber: vi.fn().mockResolvedValue(found),
    update: vi.fn().mockResolvedValue(account),
    delete: vi.fn().mockResolvedValue(account),
  };
  return {
    repository,
    service: new AccountsService(repository as unknown as AccountsRepository),
  };
}

function setupWithLedger() {
  const repository = {
    create: vi.fn().mockResolvedValue(account),
    listByUser: vi.fn().mockResolvedValue([account]),
    findByNumber: vi.fn().mockResolvedValue(account),
    update: vi.fn().mockResolvedValue(account),
    delete: vi.fn().mockResolvedValue(account),
    setStatus: vi.fn().mockResolvedValue(account),
    close: vi.fn().mockResolvedValue(account),
  };
  const ledger = {
    createAccount: vi.fn().mockResolvedValue({
      accountId: account.id,
      accountNumber: account.accountNumber,
      userId: ownerId,
      currency: 'GBP',
      availableBalance: 25,
    }),
    getBalance: vi.fn().mockResolvedValue(25),
    getBalances: vi.fn().mockResolvedValue({ [account.accountNumber]: 25 }),
    closeAccount: vi.fn().mockResolvedValue(undefined),
  };
  return {
    repository,
    ledger,
    service: new AccountsService(
      repository as unknown as AccountsRepository,
      ledger as unknown as LedgerGateway,
    ),
  };
}

describe('AccountsService', () => {
  it('rejects an invalid authenticated user ID', async () => {
    const { service, repository } = setup();

    await expect(
      service.create('usr-invalid', {
        name: 'Personal',
        accountType: 'personal',
      }),
    ).rejects.toMatchObject({ statusCode: 401 } satisfies Partial<AppError>);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('creates and maps an account', async () => {
    const { service, repository } = setup();
    await expect(
      service.create(ownerId, {
        name: 'Personal',
        accountType: 'personal',
      }),
    ).resolves.toMatchObject({ accountNumber: account.accountNumber });
    expect(repository.create).toHaveBeenCalledWith(
      1n,
      expect.objectContaining({
        accountNumber: expect.stringMatching(/^01\d{6}$/),
      }),
    );
  });

  it('retries account-number collisions', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: PrismaErrorCode.UNIQUE_CONSTRAINT,
      clientVersion: '6.19.3',
    });
    const { service, repository } = setup();
    repository.create
      .mockRejectedValueOnce(collision)
      .mockResolvedValue(account);

    await service.create(ownerId, {
      name: 'Personal',
      accountType: 'personal',
    });
    expect(repository.create).toHaveBeenCalledTimes(2);
  });

  it('fails after five account-number collisions', async () => {
    const collision = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: PrismaErrorCode.UNIQUE_CONSTRAINT,
      clientVersion: '6.19.3',
    });
    const { service, repository } = setup();
    repository.create.mockRejectedValue(collision);

    await expect(
      service.create(ownerId, {
        name: 'Personal',
        accountType: 'personal',
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(repository.create).toHaveBeenCalledTimes(5);
  });

  it('does not retry unrelated create failures', async () => {
    const error = new Error('offline');
    const { service, repository } = setup();
    repository.create.mockRejectedValue(error);
    await expect(
      service.create(ownerId, {
        name: 'Personal',
        accountType: 'personal',
      }),
    ).rejects.toBe(error);
    expect(repository.create).toHaveBeenCalledOnce();
  });

  it('returns 404 for a missing account', async () => {
    const { service } = setup(null);

    await expect(
      service.getAuthorized('01999999', 'usr-1'),
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });

  it('returns 403 for an existing account belonging to another user', async () => {
    const { service } = setup();

    await expect(
      service.getAuthorized(account.accountNumber, 'usr-2'),
    ).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<AppError>);
  });

  it('returns the account for its owner', async () => {
    const { service } = setup();

    await expect(
      service.getAuthorized(account.accountNumber, ownerId),
    ).resolves.toBe(account);
  });

  it('lists, gets, and updates mapped owned accounts', async () => {
    const { service, repository } = setup();
    await expect(service.list(ownerId)).resolves.toEqual({
      accounts: [
        expect.objectContaining({ accountNumber: account.accountNumber }),
      ],
    });
    await expect(
      service.get(account.accountNumber, ownerId),
    ).resolves.toMatchObject({ accountNumber: account.accountNumber });
    await expect(
      service.update(account.accountNumber, ownerId, { name: 'Updated' }),
    ).resolves.toMatchObject({ accountNumber: account.accountNumber });
    expect(repository.update).toHaveBeenCalledWith(account.accountNumber, {
      name: 'Updated',
    });
  });

  it('deletes an owned account', async () => {
    const { service, repository } = setup();
    await service.delete(account.accountNumber, ownerId);
    expect(repository.delete).toHaveBeenCalledWith(account.accountNumber);
  });

  it('maps foreign-key deletion failures to conflict', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('constraint', {
      code: PrismaErrorCode.FOREIGN_KEY_CONSTRAINT,
      clientVersion: '6.19.3',
    });
    const { service, repository } = setup();
    repository.delete.mockRejectedValue(prismaError);

    await expect(
      service.delete(account.accountNumber, ownerId),
    ).rejects.toMatchObject({ statusCode: 409 } satisfies Partial<AppError>);
  });

  it('rethrows unrelated deletion failures', async () => {
    const error = new Error('offline');
    const { service, repository } = setup();
    repository.delete.mockRejectedValue(error);
    await expect(service.delete(account.accountNumber, ownerId)).rejects.toBe(
      error,
    );
  });

  it('coordinates account lifecycle and balance reads with Ledger', async () => {
    const { service, repository, ledger } = setupWithLedger();

    await expect(
      service.create(ownerId, {
        name: 'Personal',
        accountType: 'personal',
      }),
    ).resolves.toMatchObject({ balance: 25 });
    expect(repository.setStatus).toHaveBeenCalledWith(
      account.accountNumber,
      'ACTIVE',
    );

    await expect(service.list(ownerId)).resolves.toEqual({
      accounts: [expect.objectContaining({ balance: 25 })],
    });
    await expect(
      service.get(account.accountNumber, ownerId),
    ).resolves.toMatchObject({
      balance: 25,
    });
    await expect(
      service.update(account.accountNumber, ownerId, {
        name: 'Updated',
        accountType: 'personal',
      }),
    ).resolves.toMatchObject({ balance: 25 });

    await service.delete(account.accountNumber, ownerId);
    expect(ledger.closeAccount).toHaveBeenCalledWith(account.accountNumber);
    expect(repository.close).toHaveBeenCalledWith(account.accountNumber);
  });

  it('records failed Ledger account creation and closure', async () => {
    const creation = setupWithLedger();
    const createError = new Error('create failed');
    creation.ledger.createAccount.mockRejectedValue(createError);
    await expect(
      creation.service.create(ownerId, {
        name: 'Personal',
        accountType: 'personal',
      }),
    ).rejects.toBe(createError);
    expect(creation.repository.setStatus).toHaveBeenCalledWith(
      account.accountNumber,
      'LEDGER_CREATION_FAILED',
    );

    const closure = setupWithLedger();
    const closeError = new Error('close failed');
    closure.ledger.closeAccount.mockRejectedValue(closeError);
    await expect(
      closure.service.delete(account.accountNumber, ownerId),
    ).rejects.toBe(closeError);
    expect(closure.repository.setStatus).toHaveBeenLastCalledWith(
      account.accountNumber,
      'LEDGER_CLOSURE_FAILED',
    );
  });
});
