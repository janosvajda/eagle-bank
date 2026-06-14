import type { Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { AccountsRepository } from './accounts.repository.js';

// This assignment is intentionally compile-time checked. It prevents a stale
// Prisma client with the former string user ID from passing CI unnoticed.
const bigintUserId = 1n;
const bigintUserIdentifier: Prisma.UserWhereUniqueInput = {
  id: bigintUserId,
};

describe('AccountsRepository', () => {
  it('delegates account persistence operations to Prisma', async () => {
    const db = {
      bankAccount: {
        create: vi.fn().mockResolvedValue('created'),
        findMany: vi.fn().mockResolvedValue(['listed']),
        findUnique: vi.fn().mockResolvedValue('found'),
        update: vi.fn().mockResolvedValue('updated'),
        delete: vi.fn().mockResolvedValue('deleted'),
      },
    };
    const repository = new AccountsRepository(db as never);
    const createData = { accountNumber: '01234567' };
    const updateData = { name: 'Updated' };

    expect(bigintUserIdentifier.id).toBe(bigintUserId);
    await repository.create(bigintUserId, createData as never);
    expect(db.bankAccount.create).toHaveBeenCalledWith({
      data: {
        ...createData,
        user: { connect: { id: 1n } },
      },
    });
    await repository.listByUser(1n);
    expect(db.bankAccount.findMany).toHaveBeenCalledWith({
      where: {
        userId: 1n,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
    });
    await repository.findByNumber('01234567');
    expect(db.bankAccount.findUnique).toHaveBeenCalledWith({
      where: { accountNumber: '01234567' },
      include: { user: { select: { id: true } } },
    });
    await repository.update('01234567', updateData);
    expect(db.bankAccount.update).toHaveBeenCalledWith({
      where: { accountNumber: '01234567' },
      data: updateData,
    });
    await repository.delete('01234567');
    expect(db.bankAccount.delete).toHaveBeenCalledWith({
      where: { accountNumber: '01234567' },
    });
    await repository.setStatus('01234567', 'PENDING_LEDGER_CLOSURE');
    expect(db.bankAccount.update).toHaveBeenCalledWith({
      where: { accountNumber: '01234567' },
      data: { status: 'PENDING_LEDGER_CLOSURE' },
    });
    await repository.close('01234567');
    expect(db.bankAccount.update).toHaveBeenCalledWith({
      where: { accountNumber: '01234567' },
      data: {
        status: 'CLOSED',
        deletedAt: expect.any(Date),
      },
    });
  });
});
