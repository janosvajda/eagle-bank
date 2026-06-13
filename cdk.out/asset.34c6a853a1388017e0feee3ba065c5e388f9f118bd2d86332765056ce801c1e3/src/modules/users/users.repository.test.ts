import { describe, expect, it, vi } from "vitest";
import { UsersRepository } from "./users.repository.js";

describe("UsersRepository", () => {
  it("delegates every operation to Prisma with scoped arguments", async () => {
    const db = {
      user: {
        create: vi.fn().mockResolvedValue("created"),
        findUnique: vi.fn().mockResolvedValue("found"),
        update: vi.fn().mockResolvedValue("updated"),
        delete: vi.fn().mockResolvedValue("deleted")
      },
      bankAccount: { count: vi.fn().mockResolvedValue(2) }
    };
    const repository = new UsersRepository(db as never);
    const createData = { id: "usr-1", name: "User" } as never;
    const updateData = { name: "Updated" };

    await expect(repository.create(createData)).resolves.toBe("created");
    expect(db.user.create).toHaveBeenCalledWith({ data: createData });
    await repository.findById("usr-1");
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: "usr-1" } });
    await repository.findByEmail("a@example.com");
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "a@example.com" }
    });
    await expect(repository.update("usr-1", updateData)).resolves.toBe("updated");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "usr-1" },
      data: updateData
    });
    await expect(repository.delete("usr-1")).resolves.toBe("deleted");
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: "usr-1" } });
    await expect(repository.countAccounts("usr-1")).resolves.toBe(2);
    expect(db.bankAccount.count).toHaveBeenCalledWith({
      where: { userId: "usr-1", status: { not: "CLOSED" } }
    });
  });
});
