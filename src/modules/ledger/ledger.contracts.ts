import { z } from 'zod';
import { Currency, TransactionType } from '../../common/domain/banking.js';

export const ledgerAccountNumberSchema = z.string().regex(/^01\d{6}$/);
const userIdSchema = z.string().regex(/^usr-[A-Za-z0-9]+$/);
const transactionTypeSchema = z.enum(TransactionType);
const MINIMUM_IDEMPOTENCY_KEY_LENGTH = 8;

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
    amount: z.number().positive(),
    currency: z.literal(Currency.GBP),
    reference: z.string().optional(),
    idempotencyKey: z.string().min(MINIMUM_IDEMPOTENCY_KEY_LENGTH).optional(),
    requestId: z.string().optional(),
    correlationId: z.string().optional(),
  })
  .strict();

export type PostLedgerTransactionCommand = z.infer<
  typeof postLedgerTransactionCommandSchema
>;

export const ledgerTransactionResponseSchema = z
  .object({
    id: z.string().regex(/^tan-[A-Za-z0-9]+$/),
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
