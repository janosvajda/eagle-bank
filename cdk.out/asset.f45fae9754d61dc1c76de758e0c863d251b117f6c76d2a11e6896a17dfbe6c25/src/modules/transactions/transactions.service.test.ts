import { Prisma, type BankAccount, type Transaction } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../common/errors/AppError.js";
import type { AccountsService } from "../accounts/accounts.service.js";
import type { TransactionsRepository } from "./transactions.repository.js";
import { TransactionsService } from "./transactions.service.js";

const account: BankAccount = {
  id: "00000000-0000-4000-8000-000000000001",
  accountNumber: "01234567",
  sortCode: "10-10-10",
  name: "Personal",
  accountType: "personal",
  balance: new Prisma.Decimal("100.00"),
  currency: "GBP",
  userId: "usr-owner",
  status: "ACTIVE",
  deletedAt: null,
  reconciliationCorrelationId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
};

const transaction: Transaction = {
  id: "tan-abc123",
  amount: new Prisma.Decimal("10.00"),
  currency: "GBP",
  type: "deposit",
  reference: null,
  userId: account.userId,
  accountId: account.id,
  createdAt: new Date("2026-01-01T00:00:00.000Z")
};

function setup(withdrawalUpdateCount = 1) {
  const tx = {
    bankAccount: {
      update: vi.fn().mockResolvedValue(account),
      updateMany: vi.fn().mockResolvedValue({ count: withdrawalUpdateCount })
    },
    transaction: {
      create: vi.fn().mockResolvedValue(transaction)
    }
  };
  const db = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    )
  };
  const repository = {
    db,
    listByAccount: vi.fn().mockResolvedValue([transaction]),
    findByIdAndAccount: vi.fn().mockResolvedValue(transaction)
  };
  const accounts = {
    getAuthorized: vi.fn().mockResolvedValue(account)
  };

  return {
    tx,
    repository,
    accounts,
    service: new TransactionsService(
      repository as unknown as TransactionsRepository,
      accounts as unknown as AccountsService
    )
  };
}

describe("TransactionsService", () => {
  it("increments balance and creates a deposit in one transaction", async () => {
    const { service, tx, repository } = setup();

    await service.create(account.accountNumber, account.userId, {
      amount: 10,
      currency: "GBP",
      type: "deposit"
    });

    expect(repository.db.$transaction).toHaveBeenCalledOnce();
    expect(tx.bankAccount.update).toHaveBeenCalledOnce();
    expect(tx.transaction.create).toHaveBeenCalledOnce();
  });

  it("conditionally decrements balance for a withdrawal", async () => {
    const { service, tx } = setup();

    await service.create(account.accountNumber, account.userId, {
      amount: 10,
      currency: "GBP",
      type: "withdrawal"
    });

    expect(tx.bankAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: account.id })
      })
    );
    expect(tx.transaction.create).toHaveBeenCalledOnce();
  });

  it("does not create a transaction when funds are insufficient", async () => {
    const { service, tx } = setup(0);

    await expect(
      service.create(account.accountNumber, account.userId, {
        amount: 101,
        currency: "GBP",
        type: "withdrawal"
      })
    ).rejects.toMatchObject({ statusCode: 422 } satisfies Partial<AppError>);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it("returns 404 when a transaction is not in the specified account", async () => {
    const { service, repository } = setup();
    repository.findByIdAndAccount.mockResolvedValue(null);

    await expect(
      service.get(account.accountNumber, "tan-other", account.userId)
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });

  it("lists mapped transactions for an authorized account", async () => {
    const { service, repository } = setup();
    await expect(
      service.list(account.accountNumber, account.userId)
    ).resolves.toEqual({
      transactions: [expect.objectContaining({ id: transaction.id })]
    });
    expect(repository.listByAccount).toHaveBeenCalledWith(account.id);
  });

  it("fetches a transaction scoped to its account", async () => {
    const { service, repository } = setup();
    await expect(
      service.get(account.accountNumber, transaction.id, account.userId)
    ).resolves.toMatchObject({ id: transaction.id });
    expect(repository.findByIdAndAccount).toHaveBeenCalledWith(
      transaction.id,
      account.id
    );
  });
});
