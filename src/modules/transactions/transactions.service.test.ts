import { Prisma, type BankAccount } from '../../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { AccountsService } from '../accounts/accounts.service.js';
import type { LedgerGateway } from '../ledger/domain/ledger.contracts.js';
import { TransactionsService } from './transactions.service.js';

const ownerId = 'usr-1';
const account: BankAccount & { userId: bigint } = {
  id: '00000000-0000-4000-8000-000000000001',
  accountNumber: '01234567',
  sortCode: '10-10-10',
  name: 'Personal',
  accountType: 'personal',
  balance: new Prisma.Decimal('100.00'),
  currency: 'GBP',
  userId: 1n,
  status: 'ACTIVE',
  deletedAt: null,
  reconciliationCorrelationId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const ledgerTransaction = {
  id: 'tan-123',
  amount: 10,
  currency: 'GBP' as const,
  type: 'deposit' as const,
  reference: 'Savings',
  userId: ownerId,
  createdTimestamp: '2026-01-01T00:00:00.000Z',
};

function setup() {
  const accounts = {
    getAuthorized: vi.fn().mockResolvedValue(account),
  };
  const ledger = {
    postTransaction: vi.fn().mockResolvedValue(ledgerTransaction),
    listTransactions: vi.fn().mockResolvedValue([ledgerTransaction]),
    getTransaction: vi.fn().mockResolvedValue(ledgerTransaction),
  };

  return {
    accounts,
    ledger,
    service: new TransactionsService(
      accounts as unknown as AccountsService,
      ledger as unknown as LedgerGateway,
    ),
  };
}

describe('TransactionsService', () => {
  it('delegates transaction posting to Ledger with Decimal money and metadata', async () => {
    const { service, accounts, ledger } = setup();

    await expect(
      service.create(
        account.accountNumber,
        ownerId,
        {
          amount: new Prisma.Decimal('10.00'),
          currency: 'GBP',
          type: 'deposit',
          reference: 'Savings',
        },
        'request-key',
      ),
    ).resolves.toEqual(ledgerTransaction);

    expect(accounts.getAuthorized).toHaveBeenCalledWith(
      account.accountNumber,
      ownerId,
    );
    expect(ledger.postTransaction).toHaveBeenCalledWith({
      accountNumber: account.accountNumber,
      userId: ownerId,
      amount: new Prisma.Decimal('10.00'),
      currency: 'GBP',
      type: 'deposit',
      reference: 'Savings',
      idempotencyKey: 'request-key',
    });
  });

  it('lists transactions only after the account ownership check passes', async () => {
    const { service, accounts, ledger } = setup();

    await expect(service.list(account.accountNumber, ownerId)).resolves.toEqual(
      {
        transactions: [ledgerTransaction],
      },
    );
    expect(accounts.getAuthorized).toHaveBeenCalledWith(
      account.accountNumber,
      ownerId,
    );
    expect(ledger.listTransactions).toHaveBeenCalledWith(account.accountNumber);
  });

  it('fetches a transaction only after the account ownership check passes', async () => {
    const { service, accounts, ledger } = setup();

    await expect(
      service.get(account.accountNumber, ledgerTransaction.id, ownerId),
    ).resolves.toEqual(ledgerTransaction);
    expect(accounts.getAuthorized).toHaveBeenCalledWith(
      account.accountNumber,
      ownerId,
    );
    expect(ledger.getTransaction).toHaveBeenCalledWith(
      account.accountNumber,
      ledgerTransaction.id,
    );
  });
});
