/**
 * 아끼로그 (AggeLog) — shared contracts.
 *
 * Types shared between apps/web and apps/api. Domain-specific contracts
 * (ledger, transaction, classification, tax prediction, etc.) are added in
 * later tasks.
 */

/** Response of the API health check endpoint (GET /health). */
export interface HealthResponse {
  status: 'ok';
}

/** Shared API version marker. */
export const API_VERSION = 'v1';
