import { constants as httpConstants } from 'node:http2';
import {
  LedgerAccountStatus,
  Prisma,
  type LedgerAccount,
} from '../../../../generated/prisma/client.js';
import type { FastifyBaseLogger } from 'fastify';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { toDecimal } from '../../../common/money/money.js';
import { TransactionType } from '../../../common/domain/banking.js';
import {
  LedgerConcurrencyError,
  rejectLedgerOperation,
} from '../domain/ledger.errors.js';
import type {
  LedgerPostingContext,
  LedgerPostingState,
} from './ledger-posting.types.js';
import type { LedgerUnitOfWork } from '../persistence/ledger.repository.js';
import type { PostLedgerTransactionCommand } from '../domain/ledger.contracts.js';

// Holds the business rules that decide whether a transaction can be posted
// before the poster writes transaction, entry, and outbox rows.
export class LedgerPostingPolicy {
  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly maxBalance: Prisma.Decimal,
  ) {}

  async prepareState(
    unitOfWork: LedgerUnitOfWork,
    context: LedgerPostingContext,
  ): Promise<LedgerPostingState> {
    const { command } = context;
    const account = await unitOfWork.findAccount(command.accountNumber);
    this.assertPostableAccount(account, context);
    this.assertCurrencyMatch(account, command);

    const amount = toDecimal(command.amount);
    const nextBalance = this.nextBalance(account, command.type, amount);
    this.assertBalanceCanBePosted(command, nextBalance);
    return { account, amount, nextBalance };
  }

  async reserveBalance(
    unitOfWork: LedgerUnitOfWork,
    state: LedgerPostingState,
  ): Promise<void> {
    if (!(await unitOfWork.reserveBalance(state.account, state.nextBalance))) {
      throw new LedgerConcurrencyError();
    }
  }

  private assertPostableAccount(
    account: LedgerAccount | null,
    context: LedgerPostingContext,
  ): asserts account is LedgerAccount {
    const { command } = context;
    if (
      !account ||
      account.status !== LedgerAccountStatus.ACTIVE ||
      account.userId !== context.userId
    ) {
      rejectLedgerOperation(
        this.logger,
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Bank account was not found',
        {
          accountNumber: command.accountNumber,
          userId: command.userId,
        },
      );
    }
  }

  private assertCurrencyMatch(
    account: LedgerAccount,
    command: PostLedgerTransactionCommand,
  ): void {
    if (account.currency !== command.currency) {
      rejectLedgerOperation(
        this.logger,
        httpConstants.HTTP_STATUS_CONFLICT,
        ErrorCode.CONFLICT,
        'Ledger account currency does not match the transaction',
        {
          accountNumber: command.accountNumber,
          userId: command.userId,
        },
      );
    }
  }

  private nextBalance(
    account: LedgerAccount,
    type: PostLedgerTransactionCommand['type'],
    amount: Prisma.Decimal,
  ): Prisma.Decimal {
    return type === TransactionType.DEPOSIT
      ? account.availableBalance.add(amount)
      : account.availableBalance.sub(amount);
  }

  private assertBalanceCanBePosted(
    command: PostLedgerTransactionCommand,
    nextBalance: Prisma.Decimal,
  ): void {
    if (nextBalance.isNegative()) {
      rejectLedgerOperation(
        this.logger,
        httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY,
        ErrorCode.INSUFFICIENT_FUNDS,
        'Insufficient funds to process transaction',
        {
          accountNumber: command.accountNumber,
          transactionType: command.type,
          userId: command.userId,
        },
      );
    }
    if (nextBalance.greaterThan(this.maxBalance)) {
      rejectLedgerOperation(
        this.logger,
        httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY,
        ErrorCode.BALANCE_LIMIT_EXCEEDED,
        'Maximum account balance would be exceeded',
        {
          accountNumber: command.accountNumber,
          transactionType: command.type,
          userId: command.userId,
        },
      );
    }
  }
}
