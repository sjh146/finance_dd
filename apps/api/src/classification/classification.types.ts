/**
 * ClassificationResult — output of any classification stage.
 * `level` records which stage produced the result (L1/L2/L3).
 */
export interface ClassificationResult {
  /** 계정과목 (e.g. 매출, 지급수수료, 복리후생비) */
  account: string;
  /** 0..1 확신도 */
  confidence: number;
  /** 분류 단계 */
  level: 'L1' | 'L2' | 'L3';
  /** "왜 이 카테고리인지" 근거 (TECH §4.1) */
  justification: string;
}

/**
 * ClassificationInput — the minimal transaction context a classifier needs.
 */
export interface ClassificationInput {
  /** 거래·적요 */
  summary: string;
  /** 거래처/가맹점 (optional) */
  merchant?: string;
  /** +/- 부호 금액 */
  amount: number;
}
