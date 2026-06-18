import { constants as httpConstants } from 'node:http2';
import { createInternalServiceToken } from '../../../common/auth/internal-service-jwt.js';
import {
  AUTHORIZATION_BEARER_PREFIX,
  ServiceIdentity,
} from '../../../common/auth/auth.constants.js';
import { AppError } from '../../../common/errors/AppError.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import {
  ledgerErrorResponseSchema,
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
} from '../domain/ledger.contracts.js';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import type { JsonValue } from '../../../common/http/json.types.js';
import { LEDGER_REQUEST_TIMEOUT_MS } from '../domain/ledger.constants.js';
import { fromDecimal } from '../../../common/money/money.js';

// Service-to-service adapter used by the public API process to call the
// private Ledger service. It implements the same gateway as LedgerService.
export class LedgerHttpClient implements LedgerGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
  ) {}

  async createAccount(
    command: LedgerAccountCommand,
  ): Promise<LedgerAccountResponse> {
    return ledgerAccountResponseSchema.parse(
      await this.request('/internal/ledger/accounts', {
        method: 'POST',
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
      await this.request('/internal/ledger/accounts/balances', {
        method: 'POST',
        body: JSON.stringify({ accountNumbers }),
      }),
    ).balances;
  }

  async closeAccount(accountNumber: string): Promise<void> {
    await this.request(`/internal/ledger/accounts/${accountNumber}/close`, {
      method: 'POST',
    });
  }

  async postTransaction(
    command: PostLedgerTransactionCommand,
  ): Promise<LedgerTransactionResponse> {
    return ledgerTransactionResponseSchema.parse(
      await this.request(
        `/internal/ledger/accounts/${command.accountNumber}/transactions`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...command,
            amount: fromDecimal(command.amount),
          }),
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
  ): Promise<JsonValue | undefined> {
    let response: Response;
    try {
      // Every private call is audience-bound to Ledger; no static internal
      // credential is sent over the service network.
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(LEDGER_REQUEST_TIMEOUT_MS),
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          authorization: `${AUTHORIZATION_BEARER_PREFIX}${createInternalServiceToken(
            {
              issuer: ServiceIdentity.API,
              audience: ServiceIdentity.LEDGER,
              secret: this.internalSecret,
            },
          )}`,
          ...init.headers,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, path }, 'Ledger service request failed');
      throw new AppError(
        httpConstants.HTTP_STATUS_SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Ledger service is unavailable',
      );
    }

    const payload =
      response.status === httpConstants.HTTP_STATUS_NO_CONTENT
        ? undefined
        : ((await response.json()) as JsonValue);
    if (!response.ok) {
      const errorBody = ledgerErrorResponseSchema.safeParse(payload);
      this.logger.warn(
        { path, statusCode: response.status },
        'Ledger service rejected request',
      );
      throw new AppError(
        response.status,
        response.status === httpConstants.HTTP_STATUS_NOT_FOUND
          ? ErrorCode.NOT_FOUND
          : ErrorCode.CONFLICT,
        errorBody.success ? errorBody.data.message : 'Ledger request failed',
      );
    }
    return payload;
  }
}
