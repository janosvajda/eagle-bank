import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../common/errors/AppError.js";
import type { UsersRepository } from "./users.repository.js";
import { UsersService } from "./users.service.js";

const user: User = {
  id: "usr-owner",
  name: "Owner",
  addressLine1: "1 Test Road",
  addressLine2: null,
  addressLine3: null,
  town: "London",
  county: "Greater London",
  postcode: "SW1A 1AA",
  phoneNumber: "+447700900001",
  email: "owner@example.com",
  passwordHash: "hash",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function setup(overrides: Record<string, unknown> = {}) {
  const repository = {
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(user),
    findById: vi.fn().mockResolvedValue(user),
    update: vi.fn().mockResolvedValue(user),
    countAccounts: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue(user),
    ...overrides,
  };
  return {
    repository,
    service: new UsersService(repository as unknown as UsersRepository),
  };
}

describe("UsersService", () => {
  const createInput = {
    name: "Owner",
    address: {
      line1: "1 Test Road",
      town: "London",
      county: "Greater London",
      postcode: "SW1A 1AA",
    },
    phoneNumber: "+447700900001",
    email: "owner@example.com",
    password: "Password123!",
  };

  it("hashes the password and creates a mapped user", async () => {
    const { service, repository } = setup();

    await expect(service.create(createInput)).resolves.toMatchObject({
      id: user.id,
      email: user.email,
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^usr-[A-Za-z0-9]+$/),
        passwordHash: expect.not.stringMatching(/^Password123!$/),
        addressLine2: null,
        addressLine3: null,
      }),
    );
  });

  it("rejects a duplicate email before hashing or creating", async () => {
    const { service, repository } = setup({
      findByEmail: vi.fn().mockResolvedValue(user),
    });

    await expect(service.create(createInput)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("returns 404 before checking ownership when the user is missing", async () => {
    const { service } = setup({ findById: vi.fn().mockResolvedValue(null) });

    await expect(
      service.getAuthorized("usr-missing", "usr-owner"),
    ).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("returns 403 for an existing user owned by someone else", async () => {
    const { service } = setup();

    await expect(
      service.getAuthorized(user.id, "usr-other"),
    ).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  it("maps an authorized user", async () => {
    const { service } = setup();
    await expect(service.get(user.id, user.id)).resolves.toMatchObject({
      id: user.id,
      email: user.email,
    });
  });

  it("updates every supplied user field", async () => {
    const { service, repository } = setup();
    const address = {
      line1: "2 Updated Road",
      line2: "Flat 2",
      line3: "West Wing",
      town: "Bristol",
      county: "Bristol",
      postcode: "BS1 1AA",
    };

    await service.update(user.id, user.id, {
      name: "Updated",
      email: "updated@example.com",
      phoneNumber: "+447700900002",
      address,
    });

    expect(repository.update).toHaveBeenCalledWith(user.id, {
      name: "Updated",
      email: "updated@example.com",
      phoneNumber: "+447700900002",
      addressLine1: address.line1,
      addressLine2: address.line2,
      addressLine3: address.line3,
      town: address.town,
      county: address.county,
      postcode: address.postcode,
    });
  });

  it("updates one field without overwriting omitted fields", async () => {
    const { service, repository } = setup();

    await service.update(user.id, user.id, { name: "Updated" });

    expect(repository.update).toHaveBeenCalledWith(user.id, {
      name: "Updated",
    });
  });

  it("clears omitted optional address lines in an address replacement", async () => {
    const { service, repository } = setup();
    await service.update(user.id, user.id, {
      address: {
        line1: "2 Updated Road",
        town: "Bristol",
        county: "Bristol",
        postcode: "BS1 1AA",
      },
    });
    expect(repository.update).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ addressLine2: null, addressLine3: null }),
    );
  });

  it("prevents deleting a user with accounts", async () => {
    const { service, repository } = setup({
      countAccounts: vi.fn().mockResolvedValue(1),
    });

    await expect(service.delete(user.id, user.id)).rejects.toMatchObject({
      statusCode: 409,
    } satisfies Partial<AppError>);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("deletes an authorized user without accounts", async () => {
    const { service, repository } = setup();

    await service.delete(user.id, user.id);

    expect(repository.delete).toHaveBeenCalledWith(user.id);
  });
});
