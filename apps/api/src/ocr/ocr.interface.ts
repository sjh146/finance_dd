/**
 * OcrResult — structured output of the OCR pipeline for a single receipt
 * image. `items` holds line-item rows when the receipt has a table.
 */
export interface OcrResult {
  /** 총 금액 */
  amount: number;
  /** 가맹점/상호 */
  merchant: string;
  /** 거래 일시 */
  date: Date;
  /** 품목 라인 (표 추출) */
  items: OcrLineItem[];
  /** 원본 텍스트 */
  rawText: string;
  /** 0..1 신뢰도 */
  confidence: number;
}

export interface OcrLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/**
 * OcrPipeline — 영수증 텍스트/표 추출 (TECH §1.1 하이브리드 PaddleOCR + VLM).
 * MVP에서는 MockOcrPipeline 구현만 제공.
 */
export interface OcrPipeline {
  extract(imageBuffer: Buffer): Promise<OcrResult>;
}
