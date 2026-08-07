import { Test, TestingModule } from '@nestjs/testing';
import { MockOcrPipeline } from './mock-ocr.pipeline';
import { OcrService, OCR_PIPELINE } from './ocr.service';

describe('MockOcrPipeline', () => {
  let pipeline: MockOcrPipeline;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockOcrPipeline],
    }).compile();
    pipeline = module.get(MockOcrPipeline);
  });

  it('returns deterministic parsed receipt data', async () => {
    const result = await pipeline.extract(Buffer.from('fake-image'));
    expect(result.amount).toBe(14500);
    expect(result.merchant).toBe('스타벅스 강남점');
    expect(result.date).toEqual(new Date('2026-01-15T02:30:00Z'));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      name: '아메리카노',
      quantity: 2,
      unitPrice: 4500,
      amount: 9000,
    });
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.rawText).toContain('합계 14,500');
  });
});

describe('OcrService', () => {
  let service: OcrService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OCR_PIPELINE, useClass: MockOcrPipeline },
        OcrService,
      ],
    }).compile();
    service = module.get(OcrService);
  });

  it('extracts a receipt through the wrapped pipeline', async () => {
    const result = await service.extractReceipt(Buffer.from('img'));
    expect(result.merchant).toBe('스타벅스 강남점');
    expect(result.amount).toBe(14500);
  });
});
