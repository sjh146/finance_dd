import { Injectable } from '@nestjs/common';
import { OcrLineItem, OcrPipeline, OcrResult } from './ocr.interface';

/**
 * MockOcrPipeline — deterministic receipt parser. Ignores the image bytes and
 * returns a fixed, stable OcrResult so tests can assert on exact values.
 */
@Injectable()
export class MockOcrPipeline implements OcrPipeline {
  async extract(_imageBuffer: Buffer): Promise<OcrResult> {
    const items: OcrLineItem[] = [
      { name: '아메리카노', quantity: 2, unitPrice: 4500, amount: 9000 },
      { name: '크로와상', quantity: 1, unitPrice: 5500, amount: 5500 },
    ];
    return {
      amount: 14500,
      merchant: '스타벅스 강남점',
      date: new Date('2026-01-15T02:30:00Z'),
      items,
      rawText: '스타벅스 강남점\n아메리카노 2 x 4,500\n크로와상 1 x 5,500\n합계 14,500',
      confidence: 0.97,
    };
  }
}
