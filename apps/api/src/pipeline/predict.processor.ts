import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { TaxPredictionService } from '../prediction/tax-prediction.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_NOTIFY_DEADLINE,
  JOB_PREDICT_VAT,
  PIPELINE_ATTEMPTS,
  QUEUE_NOTIFY,
  QUEUE_PREDICT,
} from './pipeline.constants';

/**
 * PredictJobData — payload for the predict-queue.
 * Carries the business + period. The supply value is aggregated from the DB
 * (sum of revenue transactions for the period) by the worker.
 */
export interface PredictJobData {
  /** Business id the prediction belongs to. */
  businessId: string;
  /** 신고 대상 기간 (예: 2026-Q1). */
  period: string;
  /** 공급가액 (supply value) — optional override; defaults to DB aggregate. */
  supplyValue?: number;
  /** 매입 (optional). */
  purchaseValue?: number;
}

/**
 * PredictProcessor — predict-queue worker (TECH §3, §4.2).
 *
 * Aggregates the period's revenue from the DB, runs the versioned VAT rule
 * template, persists the TaxPrediction (lo/hi/base/confidence/dueDate), and
 * chains a notify job onto the notify-queue. Updates job.progress and throws
 * on failure so BullMQ retries (3 attempts).
 */
@Processor(QUEUE_PREDICT, {
  concurrency: 1,
  limiter: { max: 10, duration: 1000 },
})
export class PredictProcessor extends WorkerHost {
  private readonly logger = new Logger(PredictProcessor.name);

  constructor(
    private readonly taxPrediction: TaxPredictionService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NOTIFY) private readonly notifyQueue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<PredictJobData>,
  ): Promise<{ base: number; dueDate: string }> {
    const { businessId, period, supplyValue, purchaseValue } = job.data;
    this.logger.log(`[predict] start business=${businessId} period=${period}`);

    await job.updateProgress(20);

    const supply =
      supplyValue ?? (await this.aggregateSupplyValue(businessId, period));

    await job.updateProgress(50);

    const prediction = await this.taxPrediction.predictVat(businessId, period, {
      supplyValue: supply,
      purchaseValue,
    });

    // Chain a notify job (deadline / closing checklist) for the business.
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (business) {
      await this.notifyQueue.add(JOB_NOTIFY_DEADLINE, {
        memberId: business.memberId,
        businessId,
        period,
        dueDate: prediction.dueDate.toISOString(),
        taxType: 'VAT',
      });
    }

    await job.updateProgress(100);

    this.logger.log(
      `[predict] done business=${businessId} period=${period} base=${prediction.base} due=${prediction.dueDate.toISOString()} (attempt ${job.attemptsMade + 1}/${PIPELINE_ATTEMPTS})`,
    );
    return { base: prediction.base, dueDate: prediction.dueDate.toISOString() };
  }

  /** Sum of revenue (positive) transactions across the business's ledgers for the period. */
  private async aggregateSupplyValue(
    businessId: string,
    period: string,
  ): Promise<number> {
    const ledgers = await this.prisma.ledger.findMany({
      where: { businessId, period },
      include: { transactions: true },
    });
    let supply = 0;
    for (const ledger of ledgers) {
      for (const txn of ledger.transactions) {
        const amount = this.toNumber(txn.amount);
        if (amount > 0) {
          supply += amount;
        }
      }
    }
    return supply;
  }

  private toNumber(amount: { toNumber(): number } | number): number {
    return typeof amount === 'number' ? amount : amount.toNumber();
  }
}

