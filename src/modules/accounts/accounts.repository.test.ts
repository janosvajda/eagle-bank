import { describe, expect, it, vi } from "vitest";
import { AccountsRepository } from "./accounts.repository.js";

describe("AccountsRepository", () => {
  it("delegates account persistence operations to Prisma", async () => {
    const db = {
      bankAccount: {
        create: vi.fn().mockResolvedValue("created"),
        findMany: vi.fn().mockResolvedValue(["listed"]),
        findUnique: vi.fn().mockResolvedValue("found"),
        update: vi.fn().mockResolvedValue("updated"),
        delete: vi.fn().mockResolvedValue("deleted"),
      },
    };
    const repository = new AccountsRepository(db as never);
    const createData = { accountNumber: "01234567" } as never;
    const updateData = { name: "Updated" };

    await repository.create(createData);
    expect(db.bankAccount.create).toHaveBeenCalledWith({ data: createData });
    await repository.listByUser("usr-1");
    expect(db.bankAccount.findMany).toHaveBeenCalledWith({
      where: { userId: "usr-1", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    await repository.findByNumber("01234567");
    expect(db.bankAccount.findUnique).toHaveBeenCalledWith({
      where: { accountNumber: "01234567" },
    });
    await repository.update("01234567", updateData);
    expect(db.bankAccount.update).toHaveBeenCalledWith({
      where: { accountNumber: "01234567" },
      data: updateData,
    });
    await repository.delete("01234567");
    expect(db.bankAccount.delete).toHaveBeenCalledWith({
      where: { accountNumber: "01234567" },
    });
    await repository.setStatus("01234567", "PENDING_LEDGER_CLOSURE");
    expect(db.bankAccount.update).toHaveBeenCalledWith({
      where: { accountNumber: "01234567" },
      data: { status: "PENDING_LEDGER_CLOSURE" },
    });
    await repository.close("01234567");
    expect(db.bankAccount.update).toHaveBeenCalledWith({
      where: { accountNumber: "01234567" },
      data: {
        status: "CLOSED",
        deletedAt: expect.any(Date),
      },
    });
  });
});
