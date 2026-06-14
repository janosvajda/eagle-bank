import { describe, expect, it } from 'vitest';
import {
  createTransactionSchema,
  transactionAccountParamsSchema,
  transactionIdSchema,
  transactionParamsSchema,
} from './transactions.schemas.js';

describe('transaction schemas', () => {
  it('validates transaction identifiers and params', () => {
    expect(transactionIdSchema.parse('tan-123')).toBe('tan-123');
    expect(
      transactionAccountParamsSchema.parse({ accountNumber: '01234567' }),
    ).toEqual({ accountNumber: '01234567' });
    expect(
      transactionParamsSchema.parse({
        accountNumber: '01234567',
        transactionId: 'tan-123',
      }),
    ).toEqual({
      accountNumber: '01234567',
      transactionId: 'tan-123',
    });
    expect(() => transactionIdSchema.parse('txn-abc')).toThrow();
  });

  it('validates transaction creation', () => {
    expect(
      createTransactionSchema.parse({
        amount: 10.5,
        currency: 'GBP',
        type: 'withdrawal',
        reference: 'ATM',
      }),
    ).toEqual({
      amount: 10.5,
      currency: 'GBP',
      type: 'withdrawal',
      reference: 'ATM',
    });
    expect(() =>
      createTransactionSchema.parse({
        amount: 0,
        currency: 'GBP',
        type: 'deposit',
      }),
    ).toThrow();
    expect(() =>
      createTransactionSchema.parse({
        amount: 1,
        currency: 'EUR',
        type: 'deposit',
      }),
    ).toThrow();
  });
});
