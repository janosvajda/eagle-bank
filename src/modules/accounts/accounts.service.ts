import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { mapAccount } from "./accounts.mapper.js";
import type { AccountsRepository } from "./accounts.repository.js";
import type {
  CreateAccountInput,
  UpdateAccountInput
} from "./accounts.schemas.js";

export class AccountsService {
  constructor(private readonly accounts: AccountsRepository) {}

  private generateAccountNumber(): string {
    return `01${randomInt(0, 1_000_000).toString().padStart(6, "0")}`;
  }

  async create(userId: string, input: CreateAccountInput) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const account = await this.accounts.create({
          accountNumber: this.generateAccountNumber(),
          name: input.name,
          accountType: input.accountType,
          userId
        });
        return mapAccount(account);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new AppError(500, ErrorCode.INTERNAL_ERROR, "Unable to allocate account number");
  }

  async getAuthorized(accountNumber: string, userId: string) {
    const account = await this.accounts.findByNumber(accountNumber);
    if (!account) {
      throw new AppError(404, ErrorCode.NOT_FOUND, "Bank account was not found");
    }
    if (account.userId !== userId) {
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        "You are not allowed to access this bank account"
      );
    }
    return account;
  }

  async list(userId: string) {
    return { accounts: (await this.accounts.listByUser(userId)).map(mapAccount) };
  }

  async get(accountNumber: string, userId: string) {
    return mapAccount(await this.getAuthorized(accountNumber, userId));
  }

  async update(
    accountNumber: string,
    userId: string,
    input: UpdateAccountInput
  ) {
    await this.getAuthorized(accountNumber, userId);
    return mapAccount(await this.accounts.update(accountNumber, input));
  }

  async delete(accountNumber: string, userId: string): Promise<void> {
    await this.getAuthorized(accountNumber, userId);
    try {
      await this.accounts.delete(accountNumber);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          "A bank account with transactions cannot be deleted"
        );
      }
      throw error;
    }
  }
}
