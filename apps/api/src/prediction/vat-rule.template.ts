/**
 * VatPredictionInput — inputs to the VAT rule template.
 * `supplyValue` (공급가액) is required; `purchaseValue` (매입) is optional.
 */
export interface VatPredictionInput {
  /** 공급가액 */
  supplyValue: number;
  /** 매입 (optional) */
  purchaseValue?: number;
}

/**
 * VatPrediction — output of the VAT rule template.
 * `base` = 예측 기준 금액, `lo`/`hi` = 신뢰 구간, `dueDate` = 신고기한.
 */
export interface VatPrediction {
  lo: number;
  hi: number;
  base: number;
  confidence: number;
  dueDate: Date;
}

/**
 * VatRuleTemplate — versioned rule template for VAT prediction (TECH §4.2).
 * VAT rate 10%, version 'template:vat-10pct-v1'.
 *
 * 신뢰 구간: base = supplyValue * 0.1, lo = base * 0.9, hi = base * 1.1.
 * 신고기한: 분기 1/25·4/25·7/25·10/25.
 */
export class VatRuleTemplate {
  static readonly VERSION = 'template:vat-10pct-v1';
  static readonly VAT_RATE = 0.1;
  static readonly CONFIDENCE = 0.9;

  /**
   * Compute the VAT due date for a given quarter period (e.g. '2026-Q1').
   * 부가세 신고기한: 분기 1/25·4/25·7/25·10/25.
   */
  static dueDateForPeriod(period: string): Date {
    const match = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!match) {
      throw new Error(`Invalid quarter period: ${period} (expected YYYY-Qn)`);
    }
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const month = (quarter - 1) * 3 + 1; // 1, 4, 7, 10
    return new Date(Date.UTC(year, month - 1, 25));
  }

  /**
   * Predict VAT for a given period and supply value.
   */
  predict(input: VatPredictionInput, period: string): VatPrediction {
    const base = input.supplyValue * VatRuleTemplate.VAT_RATE;
    return {
      base,
      lo: base * 0.9,
      hi: base * 1.1,
      confidence: VatRuleTemplate.CONFIDENCE,
      dueDate: VatRuleTemplate.dueDateForPeriod(period),
    };
  }
}
