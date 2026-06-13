import type {
  LedgerAccountCommand,
  LedgerGateway,
  LedgerTransactionResponse,
  PostLedgerTransactionCommand,
} from "./ledger.service.js";
import type { LedgerAccount } from "@prisma/client";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { createInternalServiceToken } from "../../common/auth/internal-service-jwt.js";

const LEDGER_REQUEST_TIMEOUT_MS = 2000;

export class LedgerHttpClient implements LedgerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async createAccount(command: LedgerAccountCommand): Promise<LedgerAccount> {
    return this.request("/internal/ledger/accounts", {
      method: "POST",
      body: JSON.stringify(command),
    });
  }

  getBalance(accountNumber: string): Promise<number> {
    return this.request<{ balance: number }>(
      `/internal/ledger/accounts/${accountNumber}/balance`,
    ).then((result) => result.balance);
  }

  getBalances(accountNumbers: string[]): Promise<Record<string, number>> {
    return this.request<{ balances: Record<string, number> }>(
      "/internal/ledger/accounts/balances",
      {
        method: "POST",
        body: JSON.stringify({ accountNumbers }),
      },
    ).then((result) => result.balances);
  }

  async closeAccount(accountNumber: string): Promise<void> {
    await this.request(`/internal/ledger/accounts/${accountNumber}/close`, {
      method: "POST",
    });
  }

  postTransaction(
    command: PostLedgerTransactionCommand,
  ): Promise<LedgerTransactionResponse> {
    return this.request(
      `/internal/ledger/accounts/${command.accountNumber}/transactions`,
      {
        method: "POST",
        body: JSON.stringify(command),
      },
    );
  }

  listTransactions(
    accountNumber: string,
  ): Promise<LedgerTransactionResponse[]> {
    return this.request<{ transactions: LedgerTransactionResponse[] }>(
      `/internal/ledger/accounts/${accountNumber}/transactions`,
    ).then((result) => result.transactions);
  }

  getTransaction(
    accountNumber: string,
    transactionId: string,
  ): Promise<LedgerTransactionResponse> {
    return this.request(
      `/internal/ledger/accounts/${accountNumber}/transactions/${transactionId}`,
    );
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(LEDGER_REQUEST_TIMEOUT_MS),
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${createInternalServiceToken({
            issuer: "api",
            audience: "ledger-service",
            secret: this.internalSecret,
          })}`,
          ...init.headers,
        },
      });
    } catch {
      throw new AppError(
        503,
        ErrorCode.SERVICE_UNAVAILABLE,
        "Ledger service is unavailable",
      );
    }
    const payload = response.status === 204 ? undefined : await response.json();
    if (!response.ok) {
      const body = payload as { message?: string };
      throw new AppError(
        response.status,
        response.status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.CONFLICT,
        body.message ?? "Ledger request failed",
      );
    }
    return payload as T;
  }
}
