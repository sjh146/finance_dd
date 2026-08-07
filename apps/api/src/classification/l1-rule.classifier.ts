import { Injectable } from '@nestjs/common';
import {
  ClassificationInput,
  ClassificationResult,
} from './classification.types';

/**
 * L1RuleClassifier — rule-based classification using a merchant/industry
 * dictionary (TECH §4.1). Maps transaction summary/merchant → 계정과목.
 *
 * If no rule matches (or the best match is below the confidence threshold),
 * the classifier signals fallthrough to L2 by returning a low-confidence
 * result (confidence < threshold).
 */
@Injectable()
export class L1RuleClassifier {
  /** 확신도 임계값 — 이 미만이면 L2로 하강. */
  static readonly THRESHOLD = 0.6;

  /**
   * 내장 사전: keyword → { account, confidence }.
   * Ordered so more specific keywords can be checked first if needed.
   */
  private readonly dictionary: Array<{
    keywords: string[];
    account: string;
    confidence: number;
  }> = [
    { keywords: ['개발 용역', '용역', '개발비', '프로젝트'], account: '매출', confidence: 0.95 },
    { keywords: ['aws', '클라우드', '서버', '호스팅'], account: '지급수수료', confidence: 0.9 },
    { keywords: ['식비', '점심', '저녁', '식사', '카페', '커피'], account: '복리후생비', confidence: 0.85 },
    { keywords: ['교통', '통행료', '주유', '기름', '택시'], account: '여비교통비', confidence: 0.8 },
    { keywords: ['접대', '회식', '선물'], account: '접대비', confidence: 0.85 },
    { keywords: ['급여', '월급', '임금'], account: '급여', confidence: 0.95 },
    { keywords: ['임대료', '월세', '렌트'], account: '임차료', confidence: 0.9 },
    { keywords: ['통신', '인터넷', '휴대폰'], account: '통신비', confidence: 0.85 },
    { keywords: ['보험', '국민연금', '건강보험'], account: '보험료', confidence: 0.85 },
    { keywords: ['세금', '부가세', '소득세'], account: '세금과공과', confidence: 0.9 },
  ];

  /**
   * Classify a transaction. Returns a ClassificationResult at level 'L1'.
   * When no rule matches, returns a low-confidence result that triggers
   * fallthrough to L2 in the pipeline.
   */
  classify(input: ClassificationInput): ClassificationResult {
    const text = `${input.summary} ${input.merchant ?? ''}`.toLowerCase();

    let best: { account: string; confidence: number } | null = null;
    for (const rule of this.dictionary) {
      if (rule.keywords.some((k) => text.includes(k))) {
        if (!best || rule.confidence > best.confidence) {
          best = { account: rule.account, confidence: rule.confidence };
        }
      }
    }

    if (best && best.confidence >= L1RuleClassifier.THRESHOLD) {
      return {
        account: best.account,
        confidence: best.confidence,
        level: 'L1',
        justification: `L1 규칙: 사전 키워드 매칭 → ${best.account}`,
      };
    }

    // No confident match → signal fallthrough to L2.
    return {
      account: '미분류',
      confidence: 0,
      level: 'L1',
      justification: 'L1 규칙 매칭 실패 — L2로 하강',
    };
  }
}
