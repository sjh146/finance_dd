/**
 * Pipeline constants — queue names, job names, and Redis connection config
 * for the BullMQ worker pipeline (TECH_ARCHITECTURE.md §3).
 *
 * Pipeline: ingest -> ocr -> classify -> predict -> notify
 */

/** BullMQ queue names (TECH §3 worker pipeline). */
export const QUEUE_INGEST = 'ingest-queue';
export const QUEUE_OCR = 'ocr-queue';
export const QUEUE_CLASSIFY = 'classify-queue';
export const QUEUE_PREDICT = 'predict-queue';
export const QUEUE_NOTIFY = 'notify-queue';

/** All pipeline queues, in execution order. */
export const PIPELINE_QUEUES = [
  QUEUE_INGEST,
  QUEUE_OCR,
  QUEUE_CLASSIFY,
  QUEUE_PREDICT,
  QUEUE_NOTIFY,
] as const;

/** Job names per queue. */
export const JOB_INGEST_TRANSACTIONS = 'ingest-transactions';
export const JOB_OCR_RECEIPT = 'ocr-receipt';
export const JOB_CLASSIFY_TRANSACTION = 'classify-transaction';
export const JOB_PREDICT_VAT = 'predict-vat';
export const JOB_NOTIFY_DEADLINE = 'notify-deadline';

/** Default retry attempts for pipeline jobs (요구사항: 실패 시 3회 재시도). */
export const PIPELINE_ATTEMPTS = 3;

/** Default backoff for retries (exponential, base 1s). */
export const PIPELINE_BACKOFF = { type: 'exponential' as const, delay: 1000 };

/**
 * Resolve the Redis connection options from the environment.
 *
 * Reads REDIS_URL from the environment (defaults to localhost:6379 per
 * .env.example). The value is passed as a `url` so BullMQ/ioredis parses it.
 */
export function redisConnection(): { url: string } {
  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  return { url };
}
