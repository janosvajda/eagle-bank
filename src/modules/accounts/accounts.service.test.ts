import { Prisma, type BankAccount } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../common/errors/AppError.js";
import type { AccountsRepository } from "./accounts.repository.js";
import { AccountsService } from "./accounts.service.js";

const account: BankAccount = {
  id: "00000000-0000-4000-8000-000000000001",
  accountNumber: "01234567",
  sortCode: "10-10-10",
  name: "Personal",
  accountType: "personal",
  balance: new Prisma.Decimal("0.00"),
  currency: "GBP",
  userId: "usr-owner",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
};

function setup(found: BankAccount | null = account) {
  const repository = {
    create: vi.fn().mockResolvedValue(account),
    listByUser: vi.fn().mockResolvedValue([account]),
    findByNumber: vi.fn().mockResolvedValue(found),
    update: vi.fn().mockResolvedValue(account),
    delete: vi.fn().mockResolvedValue(account)
  };
  return {
    repository,
    service: new AccountsService(repository as unknown as AccountsRepository)
  };
}

describe("AccountsService", () => {
  it("creates and maps an account", async () => {
    const { service, repository } = setup();
    await expect(
      service.create(account.userId, {
        name: "Personal",
        accountType: "personal"
      })
    ).resolves.toMatchObject({ accountNumber: account.accountNumber });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: expect.stringMatching(/^01\d{6}$/),
        userId: account.userId
      })
    );
  });

  it("retries account-number collisions", async () => {
    const collision = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "6.19.3"
    });
    const { service, repository } = setup();
    repository.create.mockRejectedValueOnce(collision).mockResolvedValue(account);

    await service.create(account.userId, {
      name: "Personal",
      accountType: "personal"
    });
    expect(repository.create).toHaveBeenCalledTimes(2);
  });

  it("fails after five account-number collisions", async () => {
    const collision = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "6.19.3"
    });
    const { service, repository } = setup();
    repository.create.mockRejectedValue(collision);

    await expect(
      service.create(account.userId, {
        name: "Personal",
        accountType: "personal"
      })
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(repository.create).toHaveBeenCalledTimes(5);
  });

  it("does not retry unrelated create failures", async () => {
    const error = new Error("offline");
    const { service, repository } = setup();
    repository.create.mockRejectedValue(error);
    await expect(
      service.create(account.userId, {
        name: "Personal",
        accountType: "personal"
      })
    ).rejects.toBe(error);
    expect(repository.create).toHaveBeenCalledOnce();
  });

  it("returns 404 for a missing account", async () => {
    const { service } = setup(null);

    await expect(
      service.getAuthorized("01999999", "usr-owner")
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });

  it("returns 403 for an existing account belonging to another user", async () => {
    const { service } = setup();

    await expect(
      service.getAuthorized(account.accountNumber, "usr-other")
    ).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<AppError>);
  });

  it("returns the account for its owner", async () => {
    const { service } = setup();

    await expect(
      service.getAuthorized(account.accountNumber, account.userId)
    ).resolves.toBe(account);
  });

  it("lists, gets, and updates mapped owned accounts", async () => {
    const { service, repository } = setup();
    await expect(service.list(account.userId)).resolves.toEqual({
      accounts: [expect.objectContaining({ accountNumber: account.accountNumber })]
    });
    await expect(
      service.get(account.accountNumber, account.userId)
    ).resolves.toMatchObject({ accountNumber: account.accountNumber });
    await expect(
      service.update(account.accountNumber, account.userId, { name: "Updated" })
    ).resolves.toMatchObject({ accountNumber: account.accountNumber });
    expect(repository.update).toHaveBeenCalledWith(account.accountNumber, {
      name: "Updated"
    });
  });

  it("deletes an owned account", async () => {
    const { service, repository } = setup();
    await service.delete(account.accountNumber, account.userId);
    expect(repository.delete).toHaveBeenCalledWith(account.accountNumber);
  });

  it("maps foreign-key deletion failures to conflict", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("constraint", {
      code: "P2003",
      clientVersion: "6.19.3"
    });
    const { service, repository } = setup();
    repository.delete.mockRejectedValue(prismaError);

    await expect(
      service.delete(account.accountNumber, account.userId)
    ).rejects.toMatchObject({ statusCode: 409 } satisfies Partial<AppError>);
  });

  it("rethrows unrelated deletion failures", async () => {
    const error = new Error("offline");
    const { service, repository } = setup();
    repository.delete.mockRejectedValue(error);
    await expect(
      service.delete(account.accountNumber, account.userId)
    ).rejects.toBe(error);
  });
});
