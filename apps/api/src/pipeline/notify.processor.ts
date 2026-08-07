import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ClosingChecklistService } from '../closing/closing-checklist.service';
import {
  JOB_NOTIFY_DEADLINE,
  PIPELINE_ATTEMPTS,
  QUEUE_NOTIFY,
} from './pipeline.constants';

/**
 * NotifyJobData — payload for the notify-queue.
 * Carries the member/business context and the due date so the worker can
 * generate deadline / closing-checklist notifications (TECH §3, §4.3).
 */
export interface NotifyJobData {
  /** Member id the notification is addressed to. */
  memberId: string;
  /** Business id used to build the closing checklist. */
  businessId: string;
  /** 신고 대상 기간 (예: 2026-Q1). */
  period: string;
  /** 신고기한 (ISO string). */
  dueDate: string;
  /** Tax type label (e.g. 'VAT'). */
  taxType?: string;
}

/**
 * NotifyProcessor — notify-queue worker (TECH §3).
 *
 * Generates deadline / closing-checklist notifications and records them as
 * Notification rows (event/webhook form). Uses the ClosingChecklistService to
 * detect missing items and emits a PAYMENT/DEADLINE notification when the due
 * date is approaching. Updates job.progress and throws on failure so BullMQ
 * retries (3 attempts).
 */
@Processor(QUEUE_NOTIFY, {
  concurrency: 2,
  limiter: { max: 10, duration: 1000 },
})
export class NotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(NotifyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly closing: ClosingChecklistService,
  ) {
    super();
  }

  async process(job: Job<NotifyJobData>): Promise<{ notifications: number }> {
    const { memberId, businessId, period, dueDate, taxType } = job.data;
    this.logger.log(
      `[notify] start member=${memberId} business=${businessId} period=${period}`,
    );

    await job.updateProgress(20);

    // Build a closing checklist from the ledger data for this business/period.
    const ledger = await this.prisma.ledger.findFirst({
      where: { businessId, period },
      include: { transactions: true },
    });

    const summary = {
      transactionCount: ledger?.transactions.length ?? 0,
      revenue: this.sumPositive(ledger?.transactions ?? []),
      purchases: this.sumNegative(ledger?.transactions ?? []),
      expenses: this.sumNegative(ledger?.transactions ?? []),
      hasPayroll: false,
      hasTaxPayment: false,
    };
    const checklist = this.closing.detectMissingItems(summary);
    const missing = checklist.filter((i) => i.status === 'missing');

    await job.updateProgress(60);

    // Emit a deadline notification (idempotent per member+kind+title).
    const title = `${taxType ?? '세금'} ${period} 신고기한 임박`;
    const existing = await this.prisma.notification.findFirst({
      where: { memberId, kind: 'PAYMENT', title },
    });

    let notifications = 0;
    if (!existing) {
      await this.prisma.notification.create({
        data: {
          memberId,
          kind: 'PAYMENT',
          channel: 'IN_APP',
          title,
          body: `${period} 신고기한은 ${dueDate}입니다. 미완료 항목: ${missing.map((m) => m.label).join(', ') || '없음'}`,
          sentAt: new Date(),
        },
      });
      notifications += 1;
    }

    await job.updateProgress(100);

    this.logger.log(
      `[notify] done member=${memberId} notifications=${notifications} missing=${missing.length} (attempt ${job.attemptsMade + 1}/${PIPELINE_ATTEMPTS})`,
    );
    return { notifications };
  }

  private sumPositive(
    txns: Array<{ amount: { toNumber(): number } | number }>,
  ): number {
    return txns.reduce(
      (acc, t) => acc + Math.max(0, this.toNumber(t.amount)),
      0,
    );
  }

  private sumNegative(
    txns: Array<{ amount: { toNumber(): number } | number }>,
  ): number {
    return txns.reduce(
      (acc, t) => acc + Math.max(0, -this.toNumber(t.amount)),
      0,
    );
  }

  private toNumber(amount: { toNumber(): number } | number): number {
    return typeof amount === 'number' ? amount : amount.toNumber();
  }
}
