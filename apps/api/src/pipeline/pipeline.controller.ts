import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Consent } from '../adapters/adapter.interface';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { AuthMemberId } from '../auth/current-member.decorator';
import { PrismaService } from '../prisma/prisma.service';
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
@UseGuards(ApiKeyGuard)
export class PipelineController {
  private readonly logger = new Logger(PipelineController.name);

  constructor(
    private readonly orchestrator: PipelineOrchestratorService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_INGEST) private readonly ingestQueue: Queue,
    @InjectQueue(QUEUE_OCR) private readonly ocrQueue: Queue,
    @InjectQueue(QUEUE_CLASSIFY) private readonly classifyQueue: Queue,
    @InjectQueue(QUEUE_PREDICT) private readonly predictQueue: Queue,
    @InjectQueue(QUEUE_NOTIFY) private readonly notifyQueue: Queue,
  ) {}

  @Post('run')
  async run(
    @Body() body: PipelineRunBody,
    @AuthMemberId() authMemberId: string,
  ): Promise<PipelineRunResult> {
    // 소유권 검증: businessId가 인증된 회원 소유인지 확인 (아니면 403).
    await this.assertBusinessOwnership(authMemberId, body.businessId);
    // 소유권 검증: ledgerId가 해당 business 소속인지 확인 (아니면 403).
    await this.assertLedgerOwnership(body.businessId, body.ledgerId);

    const req: PipelineRunRequest = {
      businessId: body.businessId,
      ledgerId: body.ledgerId,
      period: body.period,
      consent: body.consent,
      from: body.from,
      to: body.to,
    };
    this.logger.log(
      `[controller] POST /api/pipeline/run business=${body.businessId} period=${body.period} member=${authMemberId}`,
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

  /**
   * businessId가 인증된 회원 소유인지 확인한다. 아니면 403을 던진다.
   */
  private async assertBusinessOwnership(
    authMemberId: string,
    businessId: string,
  ): Promise<void> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { memberId: true },
    });
    if (!business || business.memberId !== authMemberId) {
      throw new ForbiddenException(
        'You do not have access to this business.',
      );
    }
  }

  /**
   * ledgerId가 해당 business 소속인지 확인한다. 아니면 403을 던진다.
   */
  private async assertLedgerOwnership(
    businessId: string,
    ledgerId: string,
  ): Promise<void> {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
      select: { businessId: true },
    });
    if (!ledger || ledger.businessId !== businessId) {
      throw new ForbiddenException(
        'You do not have access to this ledger.',
      );
    }
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
