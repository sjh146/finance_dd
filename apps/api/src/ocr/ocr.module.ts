import { Module } from '@nestjs/common';
import { MockOcrPipeline } from './mock-ocr.pipeline';
import { OcrService, OCR_PIPELINE } from './ocr.service';

/**
 * OcrModule — receipt OCR pipeline. Binds MockOcrPipeline to the OCR_PIPELINE
 * token and exposes OcrService.
 */
@Module({
  providers: [
    { provide: OCR_PIPELINE, useClass: MockOcrPipeline },
    OcrService,
  ],
  exports: [OcrService],
})
export class OcrModule {}
