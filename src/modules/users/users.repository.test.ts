import { describe, expect, it, vi } from 'vitest';
import { UsersRepository } from './users.repository.js';

describe('UsersRepository', () => {
  it('delegates every operation to Prisma with scoped arguments', async () => {
    const db = {
      user: {
        create: vi.fn().mockResolvedValue('created'),
        findUnique: vi.fn().mockResolvedValue('found'),
        update: vi.fn().mockResolvedValue('updated'),
        delete: vi.fn().mockResolvedValue('deleted'),
      },
      bankAccount: { count: vi.fn().mockResolvedValue(2) },
    };
    const repository = new UsersRepository(db as never);
    const createData = { name: 'User' } as never;
    const updateData = { name: 'Updated' };

    await expect(repository.create(createData)).resolves.toBe('created');
    expect(db.user.create).toHaveBeenCalledWith({ data: createData });
    await repository.findById(1n);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 1n } });
    await repository.findByEmail('a@example.com');
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'a@example.com' },
    });
    await expect(repository.update(1n, updateData)).resolves.toBe('updated');
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: updateData,
    });
    await expect(repository.delete(1n)).resolves.toBe('deleted');
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    await expect(repository.countAccounts(1n)).resolves.toBe(2);
    expect(db.bankAccount.count).toHaveBeenCalledWith({
      where: { userId: 1n, status: { not: 'CLOSED' } },
    });
  });
});
