import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { OcrService } from '../ocr/ocr.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  JOB_OCR_RECEIPT,
  PIPELINE_ATTEMPTS,
  QUEUE_OCR,
} from './pipeline.constants';

/**
 * OcrJobData — payload for the ocr-queue.
 * Carries the receipt image bytes (base64) and the ledger/voucher context so
 * the extracted result can be persisted.
 */
export interface OcrJobData {
  /** Receipt image bytes, base64-encoded. */
  imageBase64: string;
  /** Ledger id the extracted receipt belongs to. */
  ledgerId: string;
  /** Optional voucher id to attach the OCR result to. */
  voucherId?: string;
}

/**
 * OcrProcessor — ocr-queue worker (TECH §3).
 *
 * Runs the receipt image through the OCR pipeline (mock-ocr.pipeline via
 * OcrService) and persists the extracted result as a Transaction. Updates
 * job.progress and throws on failure so BullMQ retries (3 attempts).
 */
@Processor(QUEUE_OCR, {
  concurrency: 2,
  limiter: { max: 10, duration: 1000 },
})
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private readonly ocrService: OcrService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<OcrJobData>): Promise<{ extracted: boolean; amount: number }> {
    const { imageBase64, ledgerId } = job.data;
    this.logger.log(`[ocr] start ledger=${ledgerId}`);

    await job.updateProgress(20);

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const result = await this.ocrService.extractReceipt(imageBuffer);

    await job.updateProgress(60);

    // Persist the extracted receipt as a Transaction (source: OCR).
    const transaction = await this.prisma.transaction.create({
      data: {
        ledgerId,
        amount: -result.amount, // receipt = expense
        occurredAt: result.date,
        summary: `${result.merchant} (OCR)`,
        provider: 'CARD',
      },
    });

    await job.updateProgress(100);

    this.logger.log(
      `[ocr] done merchant=${result.merchant} amount=${result.amount} txn=${transaction.id} (attempt ${job.attemptsMade + 1}/${PIPELINE_ATTEMPTS})`,
    );
    return { extracted: true, amount: result.amount };
  }
}
