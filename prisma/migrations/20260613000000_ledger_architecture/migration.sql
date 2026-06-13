CREATE TYPE "AccountStatus" AS ENUM (
  'PENDING_LEDGER_CREATION',
  'ACTIVE',
  'LEDGER_CREATION_FAILED',
  'PENDING_LEDGER_CLOSURE',
  'LEDGER_CLOSURE_FAILED',
  'CLOSED'
);
CREATE TYPE "LedgerAccountStatus" AS ENUM ('ACTIVE', 'CLOSED');
CREATE TYPE "LedgerEntryDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "LedgerRecordStatus" AS ENUM ('POSTED');
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD');

ALTER TABLE "BankAccount"
  ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'PENDING_LEDGER_CREATION',
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "reconciliationCorrelationId" TEXT;

UPDATE "BankAccount" SET "status" = 'ACTIVE';

DROP INDEX "BankAccount_userId_idx";
CREATE INDEX "BankAccount_userId_status_createdAt_idx"
  ON "BankAccount"("userId", "status", "createdAt");
CREATE INDEX "BankAccount_status_updatedAt_idx"
  ON "BankAccount"("status", "updatedAt");

CREATE TABLE "LedgerAccount" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "userId" VARCHAR(36) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "availableBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "LedgerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerTransaction" (
  "id" UUID NOT NULL,
  "transactionId" TEXT NOT NULL,
  "ledgerAccountId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "userId" VARCHAR(36) NOT NULL,
  "type" "TransactionType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "reference" TEXT,
  "status" "LedgerRecordStatus" NOT NULL DEFAULT 'POSTED',
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
  "id" UUID NOT NULL,
  "ledgerTransactionId" UUID NOT NULL,
  "ledgerAccountId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "direction" "LedgerEntryDirection" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "balanceAfter" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerIdempotencyKey" (
  "id" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" VARCHAR(36) NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
  "responsePayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LedgerIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerOutboxEvent" (
  "id" UUID NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingLeaseExpiresAt" TIMESTAMP(3),
  "processingToken" UUID,
  "lastError" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LedgerOutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerAccount_accountId_key" ON "LedgerAccount"("accountId");
CREATE UNIQUE INDEX "LedgerAccount_accountNumber_key" ON "LedgerAccount"("accountNumber");
CREATE UNIQUE INDEX "LedgerTransaction_transactionId_key" ON "LedgerTransaction"("transactionId");
CREATE INDEX "LedgerTransaction_ledgerAccountId_createdAt_id_idx"
  ON "LedgerTransaction"("ledgerAccountId", "createdAt", "id");
CREATE INDEX "LedgerEntry_ledgerTransactionId_idx" ON "LedgerEntry"("ledgerTransactionId");
CREATE INDEX "LedgerEntry_ledgerAccountId_createdAt_id_idx"
  ON "LedgerEntry"("ledgerAccountId", "createdAt", "id");
CREATE UNIQUE INDEX "LedgerIdempotencyKey_userId_accountNumber_idempotencyKey_key"
  ON "LedgerIdempotencyKey"("userId", "accountNumber", "idempotencyKey");
CREATE INDEX "LedgerIdempotencyKey_expiresAt_idx" ON "LedgerIdempotencyKey"("expiresAt");
CREATE UNIQUE INDEX "LedgerOutboxEvent_eventId_key" ON "LedgerOutboxEvent"("eventId");
CREATE INDEX "LedgerOutboxEvent_status_nextAttemptAt_createdAt_idx"
  ON "LedgerOutboxEvent"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "LedgerOutboxEvent_status_processingLeaseExpiresAt_idx"
  ON "LedgerOutboxEvent"("status", "processingLeaseExpiresAt");
CREATE INDEX "LedgerOutboxEvent_processingToken_idx"
  ON "LedgerOutboxEvent"("processingToken");
CREATE INDEX "LedgerOutboxEvent_due_partial_idx"
  ON "LedgerOutboxEvent"("nextAttemptAt", "createdAt")
  WHERE "status" IN ('PENDING', 'FAILED');
CREATE INDEX "LedgerOutboxEvent_lease_partial_idx"
  ON "LedgerOutboxEvent"("processingLeaseExpiresAt")
  WHERE "status" = 'PROCESSING';

ALTER TABLE "LedgerAccount"
  ADD CONSTRAINT "LedgerAccount_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction"
  ADD CONSTRAINT "LedgerTransaction_ledgerAccountId_fkey"
  FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_ledgerTransactionId_fkey"
  FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_ledgerAccountId_fkey"
  FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
