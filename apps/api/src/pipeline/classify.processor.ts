import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ClassificationPipelineService } from '../classification/classification-pipeline.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_CLASSIFY_TRANSACTION,
  JOB_PREDICT_VAT,
  PIPELINE_ATTEMPTS,
  QUEUE_CLASSIFY,
  QUEUE_PREDICT,
} from './pipeline.constants';

/**
 * ClassifyJobData — payload for the classify-queue.
 * Carries a transaction id so the worker can load it, run the 3-stage
 * classification cascade (L1 -> L2 -> L3), and persist the Classification
 * history (TECH §4.1).
 */
export interface ClassifyJobData {
  /** Transaction id to classify. */
  transactionId: string;
  /** Voucher id the classification is attached to. */
  voucherId: string;
  /** VoucherLine id the classification is attached to. */
  lineId: string;
  /** Business id (used to chain predict forward). */
  businessId: string;
  /** 신고 대상 기간 (예: 2026-Q1). */
  period: string;
}

/**
 * ClassifyProcessor — classify-queue worker (TECH §3, §4.1).
 *
 * Loads a transaction, runs the L1 규칙 → L2 임베딩 → L3 LLM cascade, and
 * persists a Classification record (level, model, confidence, justification).
 * Chains a predict job onto the predict-queue. Updates job.progress and throws
 * on failure so BullMQ retries (3 attempts).
 */
@Processor(QUEUE_CLASSIFY, {
  concurrency: 2,
  limiter: { max: 10, duration: 1000 },
})
export class ClassifyProcessor extends WorkerHost {
  private readonly logger = new Logger(ClassifyProcessor.name);

  constructor(
    private readonly classification: ClassificationPipelineService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_PREDICT) private readonly predictQueue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<ClassifyJobData>,
  ): Promise<{ account: string; level: string }> {
    const { transactionId, voucherId, lineId, businessId, period } = job.data;
    this.logger.log(`[classify] start txn=${transactionId}`);

    await job.updateProgress(20);

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) {
      throw new Error(`[classify] transaction not found: ${transactionId}`);
    }

    await job.updateProgress(50);

    const result = await this.classification.classify({
      summary: transaction.summary,
      amount: Number(transaction.amount),
    });

    await job.updateProgress(80);

    // Persist Classification history (idempotent per voucher+line+level).
    const existing = await this.prisma.classification.findFirst({
      where: { voucherId, lineId, level: result.level },
    });
    const data = {
      voucherId,
      lineId,
      level: result.level,
      model: this.modelForLevel(result.level),
      confidence: result.confidence,
      justification: result.justification,
    };
    if (existing) {
      await this.prisma.classification.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.classification.create({ data });
    }

    // Chain a predict job (VAT) for the business/period. The predict worker
    // aggregates the period's revenue from the DB, so this is idempotent even
    // when chained once per transaction.
    await this.predictQueue.add(JOB_PREDICT_VAT, {
      businessId,
      period,
    });

    await job.updateProgress(100);

    this.logger.log(
      `[classify] done txn=${transactionId} account=${result.account} level=${result.level} conf=${result.confidence} (attempt ${job.attemptsMade + 1}/${PIPELINE_ATTEMPTS})`,
    );
    return { account: result.account, level: result.level };
  }

  private modelForLevel(level: 'L1' | 'L2' | 'L3'): string {
    switch (level) {
      case 'L1':
        return 'rule:industry-dictionary';
      case 'L2':
        return 'embedding:local-v1';
      case 'L3':
        return 'llm:mock-v1';
    }
  }
}
