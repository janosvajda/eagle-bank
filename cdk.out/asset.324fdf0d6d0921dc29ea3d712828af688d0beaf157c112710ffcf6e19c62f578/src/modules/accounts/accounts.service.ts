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
import type { LedgerGateway } from "../ledger/ledger.service.js";

export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly ledger?: LedgerGateway
  ) {}

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
          userId,
          status: this.ledger ? "PENDING_LEDGER_CREATION" : "ACTIVE"
        });
        if (!this.ledger) return mapAccount(account);
        try {
          const ledgerAccount = await this.ledger.createAccount({
            accountId: account.id,
            accountNumber: account.accountNumber,
            userId,
            currency: "GBP"
          });
          const active = await this.accounts.setStatus(
            account.accountNumber,
            "ACTIVE"
          );
          return mapAccount(
            active,
            Number(ledgerAccount.availableBalance.toFixed(2))
          );
        } catch (error) {
          await this.accounts.setStatus(
            account.accountNumber,
            "LEDGER_CREATION_FAILED"
          );
          throw error;
        }
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
    if (!account || account.status !== "ACTIVE") {
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
    const accounts = await this.accounts.listByUser(userId);
    if (!this.ledger) return { accounts: accounts.map((account) => mapAccount(account)) };
    const balances = await this.ledger.getBalances(
      accounts.map((account) => account.accountNumber)
    );
    return {
      accounts: accounts.map((account) =>
        mapAccount(account, balances[account.accountNumber])
      )
    };
  }

  async get(accountNumber: string, userId: string) {
    const account = await this.getAuthorized(accountNumber, userId);
    return mapAccount(
      account,
      this.ledger ? await this.ledger.getBalance(accountNumber) : undefined
    );
  }

  async update(
    accountNumber: string,
    userId: string,
    input: UpdateAccountInput
  ) {
    await this.getAuthorized(accountNumber, userId);
    const account = await this.accounts.update(accountNumber, input);
    return mapAccount(
      account,
      this.ledger ? await this.ledger.getBalance(accountNumber) : undefined
    );
  }

  async delete(accountNumber: string, userId: string): Promise<void> {
    await this.getAuthorized(accountNumber, userId);
    if (this.ledger) {
      await this.accounts.setStatus(accountNumber, "PENDING_LEDGER_CLOSURE");
      try {
        await this.ledger.closeAccount(accountNumber);
        await this.accounts.close(accountNumber);
        return;
      } catch (error) {
        await this.accounts.setStatus(accountNumber, "LEDGER_CLOSURE_FAILED");
        throw error;
      }
    }
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
