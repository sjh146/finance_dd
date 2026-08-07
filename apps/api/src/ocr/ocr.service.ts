import { Inject, Injectable } from '@nestjs/common';
import type { OcrPipeline, OcrResult } from './ocr.interface';
import { MockOcrPipeline } from './mock-ocr.pipeline';

/** Provider token for the OcrPipeline implementation. */
export const OCR_PIPELINE = Symbol('OCR_PIPELINE');

/**
 * OcrService — wraps the OcrPipeline and exposes the receipt-extraction
 * interface to the rest of the domain. Keeps the concrete pipeline behind an
 * interface so a real OCR backend can be swapped in later.
 */
@Injectable()
export class OcrService {
  constructor(
    @Inject(OCR_PIPELINE) private readonly pipeline: OcrPipeline,
  ) {}

  /**
   * Extract structured receipt data from an image buffer.
   */
  async extractReceipt(imageBuffer: Buffer): Promise<OcrResult> {
    return this.pipeline.extract(imageBuffer);
  }
}
