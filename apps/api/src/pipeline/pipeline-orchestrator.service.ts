import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Consent } from '../adapters/adapter.interface';
import {
  JOB_CLASSIFY_TRANSACTION,
  JOB_INGEST_TRANSACTIONS,
  JOB_NOTIFY_DEADLINE,
  JOB_PREDICT_VAT,
  QUEUE_CLASSIFY,
  QUEUE_INGEST,
  QUEUE_NOTIFY,
  QUEUE_PREDICT,
} from './pipeline.constants';

/**
 * PipelineRunRequest — input to syncAndProcess().
 * Identifies the business/ledger/consent and the period to process.
 */
export interface PipelineRunRequest {
  /** Business id to process. */
  businessId: string;
  /** Ledger id to attach ingested transactions to. */
  ledgerId: string;
  /** Consent used to resolve the transaction adapter. */
  consent: Consent;
  /** 신고 대상 기간 (예: 2026-Q1). */
  period: string;
  /** Fetch window start (ISO). Defaults to period start. */
  from?: string;
  /** Fetch window end (ISO). Defaults to period end. */
  to?: string;
}

/**
 * PipelineRunResult — summary of a triggered pipeline run.
 */
export interface PipelineRunResult {
  /** Job id of the ingest job (the pipeline entry point). */
  ingestJobId: string;
  /** Queues that were enqueued. */
  queues: string[];
}

/**
 * PipelineOrchestratorService — triggers the full worker pipeline
 * (TECH §3): 거래 동기화 → 분류 → 예측 → 알림.
 *
 * `syncAndProcess()` enqueues the ingest job; the ingest worker then chains
 * classify → predict → notify jobs onto their respective queues.
 */
@Injectable()
export class PipelineOrchestratorService {
  private readonly logger = new Logger(PipelineOrchestratorService.name);

  constructor(
    @InjectQueue(QUEUE_INGEST) private readonly ingestQueue: Queue,
    @InjectQueue(QUEUE_CLASSIFY) private readonly classifyQueue: Queue,
    @InjectQueue(QUEUE_PREDICT) private readonly predictQueue: Queue,
    @InjectQueue(QUEUE_NOTIFY) private readonly notifyQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Trigger the full pipeline: 거래 동기화 → 분류 → 예측 → 알림.
   *
   * Enqueues the ingest job. The ingest worker persists transactions and then
   * chains classify jobs; classify chains predict; predict chains notify.
   */
  async syncAndProcess(req: PipelineRunRequest): Promise<PipelineRunResult> {
    const { businessId, ledgerId, consent, period } = req;
    const from = req.from ?? this.periodStart(period);
    const to = req.to ?? this.periodEnd(period);

    this.logger.log(
      `[orchestrator] syncAndProcess business=${businessId} ledger=${ledgerId} period=${period}`,
    );

    const job = await this.ingestQueue.add(JOB_INGEST_TRANSACTIONS, {
      consent,
      ledgerId,
      businessId,
      period,
      from,
      to,
    });

    this.logger.log(
      `[orchestrator] enqueued ingest job=${job.id} (business=${businessId})`,
    );

    return {
      ingestJobId: job.id ?? '',
      queues: [QUEUE_INGEST, QUEUE_CLASSIFY, QUEUE_PREDICT, QUEUE_NOTIFY],
    };
  }

  /**
   * Enqueue a classify job for a single transaction (used by the ingest
   * worker to chain the pipeline forward).
   */
  async enqueueClassify(data: {
    transactionId: string;
    voucherId: string;
    lineId: string;
  }): Promise<string> {
    const job = await this.classifyQueue.add(JOB_CLASSIFY_TRANSACTION, data);
    return job.id ?? '';
  }

  /**
   * Enqueue a predict job (used by the classify worker to chain forward).
   */
  async enqueuePredict(data: {
    businessId: string;
    period: string;
    supplyValue: number;
    purchaseValue?: number;
  }): Promise<string> {
    const job = await this.predictQueue.add(JOB_PREDICT_VAT, data);
    return job.id ?? '';
  }

  /**
   * Enqueue a notify job (used by the predict worker to chain forward).
   */
  async enqueueNotify(data: {
    memberId: string;
    businessId: string;
    period: string;
    dueDate: string;
    taxType?: string;
  }): Promise<string> {
    const job = await this.notifyQueue.add(JOB_NOTIFY_DEADLINE, data);
    return job.id ?? '';
  }

  /**
   * Resolve the member id for a business (used to address notifications).
   */
  async resolveMemberId(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new Error(`[orchestrator] business not found: ${businessId}`);
    }
    return business.memberId;
  }

  /** Compute the start of a quarter period (e.g. '2026-Q1' → 2026-01-01). */
  private periodStart(period: string): string {
    const match = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!match) {
      throw new Error(`Invalid quarter period: ${period}`);
    }
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const month = (quarter - 1) * 3; // 0-based
    return new Date(Date.UTC(year, month, 1)).toISOString();
  }

  /** Compute the end of a quarter period (e.g. '2026-Q1' → 2026-03-31). */
  private periodEnd(period: string): string {
    const match = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!match) {
      throw new Error(`Invalid quarter period: ${period}`);
    }
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const month = quarter * 3; // 1-based end month (0-based index = quarter*3)
    return new Date(Date.UTC(year, month, 0, 23, 59, 59)).toISOString();
  }
}
