import { createInternalServiceToken } from "../../common/auth/internal-service-jwt.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import {
  ledgerAccountResponseSchema,
  ledgerBalanceResponseSchema,
  ledgerBalancesResponseSchema,
  ledgerTransactionListResponseSchema,
  ledgerTransactionResponseSchema,
  type LedgerAccountCommand,
  type LedgerAccountResponse,
  type LedgerGateway,
  type LedgerTransactionResponse,
  type PostLedgerTransactionCommand,
} from "./ledger.contracts.js";

const LEDGER_REQUEST_TIMEOUT_MS = 2000;

function responseMessage(payload: unknown, fallback: string): string {
  return typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
    ? payload.message
    : fallback;
}

export class LedgerHttpClient implements LedgerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
  ) {}

  async createAccount(
    command: LedgerAccountCommand,
  ): Promise<LedgerAccountResponse> {
    return ledgerAccountResponseSchema.parse(
      await this.request("/internal/ledger/accounts", {
        method: "POST",
        body: JSON.stringify(command),
      }),
    );
  }

  async getBalance(accountNumber: string): Promise<number> {
    return ledgerBalanceResponseSchema.parse(
      await this.request(`/internal/ledger/accounts/${accountNumber}/balance`),
    ).balance;
  }

  async getBalances(accountNumbers: string[]): Promise<Record<string, number>> {
    return ledgerBalancesResponseSchema.parse(
      await this.request("/internal/ledger/accounts/balances", {
        method: "POST",
        body: JSON.stringify({ accountNumbers }),
      }),
    ).balances;
  }

  async closeAccount(accountNumber: string): Promise<void> {
    await this.request(`/internal/ledger/accounts/${accountNumber}/close`, {
      method: "POST",
    });
  }

  async postTransaction(
    command: PostLedgerTransactionCommand,
  ): Promise<LedgerTransactionResponse> {
    return ledgerTransactionResponseSchema.parse(
      await this.request(
        `/internal/ledger/accounts/${command.accountNumber}/transactions`,
        {
          method: "POST",
          body: JSON.stringify(command),
        },
      ),
    );
  }

  async listTransactions(
    accountNumber: string,
  ): Promise<LedgerTransactionResponse[]> {
    return ledgerTransactionListResponseSchema.parse(
      await this.request(
        `/internal/ledger/accounts/${accountNumber}/transactions`,
      ),
    ).transactions;
  }

  async getTransaction(
    accountNumber: string,
    transactionId: string,
  ): Promise<LedgerTransactionResponse> {
    return ledgerTransactionResponseSchema.parse(
      await this.request(
        `/internal/ledger/accounts/${accountNumber}/transactions/${transactionId}`,
      ),
    );
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      // Every private call is audience-bound to Ledger; no static internal
      // credential is sent over the service network.
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

    const payload: unknown =
      response.status === 204 ? undefined : await response.json();
    if (!response.ok) {
      throw new AppError(
        response.status,
        response.status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.CONFLICT,
        responseMessage(payload, "Ledger request failed"),
      );
    }
    return payload;
  }
}
