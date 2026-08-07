import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionAdapterFactory } from '../adapters/transaction-adapter.factory';
import { Consent } from '../adapters/adapter.interface';
import {
  JOB_CLASSIFY_TRANSACTION,
  JOB_INGEST_TRANSACTIONS,
  PIPELINE_ATTEMPTS,
  QUEUE_CLASSIFY,
  QUEUE_INGEST,
} from './pipeline.constants';

/**
 * IngestJobData — payload for the ingest-queue.
 * Carries the consent + date range used to fetch transactions from the
 * external adapter (마이데이터 / 은행계열 API) and persist them to the DB.
 */
export interface IngestJobData {
  /** Consent used to resolve the transaction adapter. */
  consent: Consent;
  /** Ledger id the fetched transactions are attached to. */
  ledgerId: string;
  /** Business id (used to chain classify/predict/notify forward). */
  businessId: string;
  /** 신고 대상 기간 (예: 2026-Q1). */
  period: string;
  /** Fetch window start (inclusive). */
  from: string;
  /** Fetch window end (inclusive). */
  to: string;
}

/**
 * IngestProcessor — ingest-queue worker (TECH §3).
 *
 * Fetches transactions from the mock adapter selected by consent type,
 * persists them to the DB (Transaction entity), and chains classify jobs onto
 * the classify-queue. Updates job.progress and throws on failure so BullMQ
 * retries (3 attempts).
 */
@Processor(QUEUE_INGEST, {
  concurrency: 1,
  limiter: { max: 10, duration: 1000 },
})
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: TransactionAdapterFactory,
    @InjectQueue(QUEUE_CLASSIFY) private readonly classifyQueue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<IngestJobData>,
  ): Promise<{ ingested: number; classified: number }> {
    const { consent, ledgerId, businessId, period, from, to } = job.data;
    this.logger.log(
      `[ingest] start consent=${consent.type} ledger=${ledgerId} window=${from}..${to}`,
    );

    await job.updateProgress(10);

    const adapter = this.adapterFactory.getMyDataAdapter();
    const rawTransactions = await adapter.fetchTransactions(
      consent,
      new Date(from),
      new Date(to),
    );

    await job.updateProgress(40);

    // Ensure a voucher exists to attach classifications to.
    const voucher = await this.ensureVoucher(ledgerId, period);

    let ingested = 0;
    let classified = 0;
    for (const raw of rawTransactions) {
      // Persist atomically via upsert keyed on the (ledgerId, finNo) unique
      // constraint. This replaces the previous create + P2002-catch sequence,
      // which was still vulnerable to a TOCTOU race (CWE-362): two concurrent
      // ingests could both attempt create, and while the unique index turns the
      // second into a P2002, the check-then-act window remained. upsert is
      // atomic — exactly one row exists per (ledgerId, finNo).
      //
      // finNo is nullable; when it is null the unique constraint does not apply
      // (PostgreSQL treats NULLs as distinct), so we fall back to a plain create
      // for those rows.
      const transaction = await (raw.finNo
        ? this.prisma.transaction.upsert({
            where: {
              ledgerId_finNo: { ledgerId, finNo: raw.finNo },
            },
            update: {
              // Keep the existing row; refresh mutable fields so a re-ingest
              // reflects the latest fetched values without duplicating.
              bankAcct: raw.account,
              amount: raw.amount,
              occurredAt: raw.occurredAt,
              summary: raw.summary,
              provider: this.mapProvider(raw.provider),
            },
            create: {
              ledgerId,
              bankAcct: raw.account,
              finNo: raw.finNo,
              amount: raw.amount,
              occurredAt: raw.occurredAt,
              summary: raw.summary,
              provider: this.mapProvider(raw.provider),
            },
          })
        : this.prisma.transaction.create({
            data: {
              ledgerId,
              bankAcct: raw.account,
              finNo: raw.finNo,
              amount: raw.amount,
              occurredAt: raw.occurredAt,
              summary: raw.summary,
              provider: this.mapProvider(raw.provider),
            },
          }));

      // A freshly created row has createdAt === updatedAt (same timestamp).
      // An existing row that was merely updated has updatedAt > createdAt.
      // Only count + chain classify for newly created rows so a re-ingest of an
      // already-persisted transaction does not double-count revenue or re-run
      // classification.
      const isNew = transaction.createdAt.getTime() === transaction.updatedAt.getTime();
      if (!isNew) {
        continue;
      }
      ingested += 1;

      // Create a voucher line for the transaction and chain a classify job.
      const line = await this.prisma.voucherLine.create({
        data: {
          voucherId: voucher.id,
          account: '미분류',
          debit: raw.amount > 0 ? raw.amount : 0,
          credit: raw.amount < 0 ? -raw.amount : 0,
          amount: Math.abs(raw.amount),
          side: raw.amount > 0 ? 'DEBIT' : 'CREDIT',
        },
      });

      await this.classifyQueue.add(JOB_CLASSIFY_TRANSACTION, {
        transactionId: transaction.id,
        voucherId: voucher.id,
        lineId: line.id,
        businessId,
        period,
      });
      classified += 1;
    }

    await job.updateProgress(100);

    this.logger.log(
      `[ingest] done ingested=${ingested} classified=${classified} total=${rawTransactions.length} (attempt ${job.attemptsMade + 1}/${PIPELINE_ATTEMPTS})`,
    );
    return { ingested, classified };
  }

  /** Ensure a voucher exists for the ledger (idempotent). */
  private async ensureVoucher(ledgerId: string, _period: string) {
    return this.prisma.voucher.upsert({
      where: { ledgerId_source: { ledgerId, source: 'OPENBANK' } },
      update: {},
      create: {
        ledgerId,
        date: new Date(),
        status: 'PROVISIONAL',
        source: 'OPENBANK',
      },
    });
  }

  /** Map a raw provider string to the TransactionProvider enum. */
  private mapProvider(
    provider: string,
  ): 'OPENBANKING' | 'MYDATA' | 'BANK_API' | 'CARD' | 'MANUAL' | 'PG' {
    switch (provider) {
      case 'mydata':
        return 'MYDATA';
      case 'bank_api':
        return 'BANK_API';
      case 'openbanking':
        return 'OPENBANKING';
      case 'card':
        return 'CARD';
      case 'pg':
        return 'PG';
      default:
        return 'MANUAL';
    }
  }
}
