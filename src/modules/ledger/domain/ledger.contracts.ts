import { z } from 'zod';
import {
  ACCOUNT_NUMBER_CONTRACT_PATTERN,
  Currency,
  TransactionType,
} from '../../../common/domain/banking.js';
import { USER_API_ID_CONTRACT_PATTERN } from '../../users/user-id.js';
import { TRANSACTION_API_ID_CONTRACT_PATTERN } from '../../transactions/transaction-id.js';
import { LEDGER_MINIMUM_IDEMPOTENCY_KEY_LENGTH } from './ledger.constants.js';
import { moneySchema } from '../../../common/money/money.js';

export const ledgerAccountNumberSchema = z
  .string()
  .regex(ACCOUNT_NUMBER_CONTRACT_PATTERN);
const userIdSchema = z.string().regex(USER_API_ID_CONTRACT_PATTERN);
const transactionTypeSchema = z.enum(TransactionType);

export const ledgerAccountCommandSchema = z
  .object({
    accountId: z.uuid(),
    accountNumber: ledgerAccountNumberSchema,
    userId: userIdSchema,
    currency: z.literal(Currency.GBP),
  })
  .strict();

export type LedgerAccountCommand = z.infer<typeof ledgerAccountCommandSchema>;

export const ledgerAccountResponseSchema = ledgerAccountCommandSchema
  .extend({ availableBalance: z.number().nonnegative() })
  .strict();

export type LedgerAccountResponse = z.infer<typeof ledgerAccountResponseSchema>;

export const postLedgerTransactionCommandSchema = z
  .object({
    accountNumber: ledgerAccountNumberSchema,
    userId: userIdSchema,
    type: transactionTypeSchema,
    amount: moneySchema,
    currency: z.literal(Currency.GBP),
    reference: z.string().optional(),
    idempotencyKey: z
      .string()
      .min(LEDGER_MINIMUM_IDEMPOTENCY_KEY_LENGTH)
      .optional(),
    requestId: z.string().optional(),
    correlationId: z.string().optional(),
  })
  .strict();

export type PostLedgerTransactionCommand = z.infer<
  typeof postLedgerTransactionCommandSchema
>;

export const ledgerTransactionResponseSchema = z
  .object({
    id: z.string().regex(TRANSACTION_API_ID_CONTRACT_PATTERN),
    amount: z.number().positive(),
    currency: z.literal(Currency.GBP),
    type: transactionTypeSchema,
    reference: z.string().optional(),
    userId: userIdSchema,
    createdTimestamp: z.iso.datetime(),
  })
  .strict();

export type LedgerTransactionResponse = z.infer<
  typeof ledgerTransactionResponseSchema
>;

export const ledgerErrorResponseSchema = z
  .object({ message: z.string().min(1) })
  .passthrough();

export const ledgerBalanceResponseSchema = z
  .object({ balance: z.number().nonnegative() })
  .strict();

export const ledgerBalancesResponseSchema = z
  .object({ balances: z.record(z.string(), z.number().nonnegative()) })
  .strict();

export const ledgerTransactionListResponseSchema = z
  .object({ transactions: z.array(ledgerTransactionResponseSchema) })
  .strict();

export interface LedgerGateway {
  createAccount(command: LedgerAccountCommand): Promise<LedgerAccountResponse>;
  getBalance(accountNumber: string): Promise<number>;
  getBalances(accountNumbers: string[]): Promise<Record<string, number>>;
  closeAccount(accountNumber: string): Promise<void>;
  postTransaction(
    command: PostLedgerTransactionCommand,
  ): Promise<LedgerTransactionResponse>;
  listTransactions(accountNumber: string): Promise<LedgerTransactionResponse[]>;
  getTransaction(
    accountNumber: string,
    transactionId: string,
  ): Promise<LedgerTransactionResponse>;
}
