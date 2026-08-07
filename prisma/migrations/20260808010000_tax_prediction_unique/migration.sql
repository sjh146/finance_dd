-- Deduplicate existing tax_predictions rows before adding the unique index.
-- Keep only the most recent row per (business_id, taxType, period); delete older duplicates.
DELETE FROM "tax_predictions" a
USING "tax_predictions" b
WHERE a."business_id" = b."business_id"
  AND a."taxType" = b."taxType"
  AND a."period" = b."period"
  AND a."created_at" < b."created_at";

-- Drop the old non-unique index (replaced by the unique constraint below).
DROP INDEX "tax_predictions_business_id_taxType_period_idx";

-- CreateIndex: unique constraint on (business_id, taxType, period) — prevents
-- TOCTOU duplicate rows from concurrent predictVat calls (CWE-362).
CREATE UNIQUE INDEX "tax_predictions_business_id_taxType_period_key" ON "tax_predictions"("business_id", "taxType", "period");
