import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Consent } from '../adapters/adapter.interface';
import {
  PipelineOrchestratorService,
  PipelineRunRequest,
  PipelineRunResult,
} from './pipeline-orchestrator.service';
import {
  PIPELINE_QUEUES,
  QUEUE_CLASSIFY,
  QUEUE_INGEST,
  QUEUE_NOTIFY,
  QUEUE_OCR,
  QUEUE_PREDICT,
} from './pipeline.constants';

/**
 * PipelineRunBody — REST body for POST /api/pipeline/run.
 */
export interface PipelineRunBody {
  businessId: string;
  ledgerId: string;
  period: string;
  consent: Consent;
  from?: string;
  to?: string;
}

/**
 * PipelineController — REST endpoints to trigger and inspect the worker
 * pipeline (TECH §3).
 *
 * - POST /api/pipeline/run    → trigger syncAndProcess (거래 동기화 → 분류 → 예측 → 알림)
 * - GET  /api/pipeline/status → per-queue job counts (waiting/active/completed/failed)
 */
@Controller('api/pipeline')
export class PipelineController {
  private readonly logger = new Logger(PipelineController.name);

  constructor(
    private readonly orchestrator: PipelineOrchestratorService,
    @InjectQueue(QUEUE_INGEST) private readonly ingestQueue: Queue,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
    @InjectQueue(QUEUE_CLASSIFY) private readonly classifyQueue: Queue,
    @InjectQueue(QUEUE_PREDICT) private readonly predictQueue: Queue,
    @InjectQueue(QUEUE_NOTIFY) private readonly notifyQueue: Queue,
  ) {}

  @Post('run')
  async run(@Body() body: PipelineRunBody): Promise<PipelineRunResult> {
    const req: PipelineRunRequest = {
      businessId: body.businessId,
      ledgerId: body.ledgerId,
      period: body.period,
      consent: body.consent,
      from: body.from,
      to: body.to,
    };
    this.logger.log(
      `[controller] POST /api/pipeline/run business=${body.businessId} period=${body.period}`,
    );
    return this.orchestrator.syncAndProcess(req);
  }

  @Get('status')
  async status(): Promise<Record<string, unknown>> {
    const queues: Record<string, unknown> = {};
    for (const name of PIPELINE_QUEUES) {
      const queue = this.queueByName(name);
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      queues[name] = { waiting, active, completed, failed, delayed };
    }
    return { status: 'ok', queues };
  }

  private queueByName(name: string): Queue {
    switch (name) {
      case QUEUE_INGEST:
        return this.ingestQueue;
      case QUEUE_OCR:
        return this.ocrQueue;
      case QUEUE_CLASSIFY:
        return this.classifyQueue;
      case QUEUE_PREDICT:
        return this.predictQueue;
      case QUEUE_NOTIFY:
        return this.notifyQueue;
      default:
        throw new Error(`Unknown pipeline queue: ${name}`);
    }
  }
}
