-- Deduplicate existing transactions rows before adding the unique index.
-- Keep only the most recent row per (ledger_id, fin_no); delete older duplicates.
DELETE FROM "transactions" a
USING "transactions" b
WHERE a."ledger_id" = b."ledger_id"
  AND a."fin_no" = b."fin_no"
  AND a."created_at" < b."created_at";

-- Deduplicate existing vouchers rows before adding the unique index.
-- Keep only the most recent row per (ledger_id, source); delete older duplicates.
DELETE FROM "vouchers" a
USING "vouchers" b
WHERE a."ledger_id" = b."ledger_id"
  AND a."source" = b."source"
  AND a."created_at" < b."created_at";

-- CreateIndex: unique constraint on (ledger_id, fin_no) — prevents TOCTOU
-- duplicate transactions from concurrent ingest pipeline runs (CWE-362).
CREATE UNIQUE INDEX "transactions_ledger_id_fin_no_key" ON "transactions"("ledger_id", "fin_no");

-- CreateIndex: unique constraint on (ledger_id, source) — prevents TOCTOU
-- duplicate vouchers from concurrent ingest pipeline runs (CWE-362).
CREATE UNIQUE INDEX "vouchers_ledger_id_source_key" ON "vouchers"("ledger_id", "source");
