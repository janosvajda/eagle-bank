import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { mapUser } from "./users.mapper.js";
import type { UsersRepository } from "./users.repository.js";
import type { CreateUserInput, UpdateUserInput } from "./users.schemas.js";

export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async create(input: CreateUserInput) {
    if (await this.users.findByEmail(input.email)) {
      throw new AppError(409, ErrorCode.CONFLICT, "A user with this email already exists");
    }

    const passwordHash = await argon2.hash(input.password);
    const user = await this.users.create({
      id: `usr-${randomUUID().replaceAll("-", "")}`,
      name: input.name,
      email: input.email,
      phoneNumber: input.phoneNumber,
      passwordHash,
      addressLine1: input.address.line1,
      addressLine2: input.address.line2,
      addressLine3: input.address.line3,
      town: input.address.town,
      county: input.address.county,
      postcode: input.address.postcode
    });
    return mapUser(user);
  }

  async getAuthorized(targetId: string, authenticatedId: string) {
    const user = await this.users.findById(targetId);
    if (!user) throw new AppError(404, ErrorCode.NOT_FOUND, "User was not found");
    if (user.id !== authenticatedId) {
      throw new AppError(403, ErrorCode.FORBIDDEN, "You are not allowed to access this user");
    }
    return user;
  }

  async get(targetId: string, authenticatedId: string) {
    return mapUser(await this.getAuthorized(targetId, authenticatedId));
  }

  async update(targetId: string, authenticatedId: string, input: UpdateUserInput) {
    await this.getAuthorized(targetId, authenticatedId);
    const address = input.address;
    const user = await this.users.update(targetId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
      ...(address
        ? {
            addressLine1: address.line1,
            addressLine2: address.line2 ?? null,
            addressLine3: address.line3 ?? null,
            town: address.town,
            county: address.county,
            postcode: address.postcode
          }
        : {})
    });
    return mapUser(user);
  }

  async delete(targetId: string, authenticatedId: string): Promise<void> {
    await this.getAuthorized(targetId, authenticatedId);
    if ((await this.users.countAccounts(targetId)) > 0) {
      throw new AppError(
        409,
        ErrorCode.CONFLICT,
        "A user cannot be deleted while associated with a bank account"
      );
    }
    await this.users.delete(targetId);
  }
}
