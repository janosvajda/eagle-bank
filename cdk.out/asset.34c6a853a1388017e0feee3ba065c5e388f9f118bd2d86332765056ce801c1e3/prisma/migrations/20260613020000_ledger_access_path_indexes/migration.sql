DROP INDEX "LedgerTransaction_ledgerAccountId_createdAt_id_idx";
CREATE INDEX "LedgerTransaction_accountId_createdAt_id_idx"
  ON "LedgerTransaction"("accountId", "createdAt", "id");
CREATE INDEX "LedgerTransaction_ledgerAccountId_idx"
  ON "LedgerTransaction"("ledgerAccountId");

DROP INDEX "LedgerEntry_ledgerAccountId_createdAt_id_idx";
CREATE INDEX "LedgerEntry_accountId_createdAt_id_idx"
  ON "LedgerEntry"("accountId", "createdAt", "id");
CREATE INDEX "LedgerEntry_ledgerAccountId_idx"
  ON "LedgerEntry"("ledgerAccountId");
