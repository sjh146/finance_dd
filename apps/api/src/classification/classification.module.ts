import { Module } from '@nestjs/common';
import {
  ClassificationPipelineService,
  L2_CLASSIFIER,
  L3_CLASSIFIER,
} from './classification-pipeline.service';
import { L1RuleClassifier } from './l1-rule.classifier';
import {
  L2EmbeddingClassifierImpl,
  TrainingSample,
} from './l2-embedding.classifier';
import { MockL3Classifier } from './l3-llm.classifier';

/**
 * Default training history for the L2 embedding classifier.
 *
 * In production this is loaded from the persisted Classification history
 * (거래처, 적요, 금액 범위, 업종). For the MVP we seed a representative set so
 * the local classifier can actually classify similar transactions without any
 * external dependency.
 */
export const DEFAULT_TRAINING_SAMPLES: TrainingSample[] = [
  // 매출 (개발 용역)
  { summary: '개발 용역 대금', merchant: '고객사', amount: 5_500_000, account: '매출' },
  { summary: '프로젝트 용역비', merchant: '클라이언트', amount: 12_000_000, account: '매출' },
  { summary: '개발비 정산', merchant: '파트너사', amount: 3_200_000, account: '매출' },
  // 지급수수료 (클라우드/서버)
  { summary: 'AWS 클라우드 이용료', merchant: 'Amazon', amount: -320_000, account: '지급수수료' },
  { summary: '서버 호스팅 비용', merchant: 'Vercel', amount: -120_000, account: '지급수수료' },
  { summary: '클라우드 서버 요금', merchant: 'GCP', amount: -450_000, account: '지급수수료' },
  // 복리후생비 (식비/카페)
  { summary: '점심 식비', merchant: '식당', amount: -18_000, account: '복리후생비' },
  { summary: '저녁 회식', merchant: '레스토랑', amount: -85_000, account: '복리후생비' },
  { summary: '카페 커피', merchant: '스타벅스', amount: -6_500, account: '복리후생비' },
  // 여비교통비 (교통/주유)
  { summary: '고속도로 통행료', merchant: '한국도로공사', amount: -9_800, account: '여비교통비' },
  { summary: '주유비', merchant: 'GS칼텍스', amount: -60_000, account: '여비교통비' },
  { summary: '택시비', merchant: '카카오T', amount: -15_000, account: '여비교통비' },
  // 접대비
  { summary: '거래처 접대', merchant: '고급식당', amount: -250_000, account: '접대비' },
  { summary: '선물 구매', merchant: '백화점', amount: -120_000, account: '접대비' },
  // 급여
  { summary: '직원 급여', merchant: '급여', amount: -3_000_000, account: '급여' },
  { summary: '월급 지급', merchant: '급여', amount: -2_800_000, account: '급여' },
  // 임차료
  { summary: '사무실 임대료', merchant: '부동산', amount: -1_500_000, account: '임차료' },
  { summary: '월세 납부', merchant: '건물주', amount: -1_200_000, account: '임차료' },
  // 통신비
  { summary: '인터넷 요금', merchant: 'KT', amount: -33_000, account: '통신비' },
  { summary: '휴대폰 요금', merchant: 'SKT', amount: -55_000, account: '통신비' },
  // 보험료
  { summary: '국민연금', merchant: '국민연금공단', amount: -180_000, account: '보험료' },
  { summary: '건강보험료', merchant: '건강보험공단', amount: -150_000, account: '보험료' },
  // 세금과공과
  { summary: '부가세 납부', merchant: '국세청', amount: -1_100_000, account: '세금과공과' },
  { summary: '소득세', merchant: '국세청', amount: -900_000, account: '세금과공과' },
];

/**
 * ClassificationModule — 3-stage classification pipeline (L1 규칙 → L2 → L3).
 * L2 is a real local embedding classifier trained on past history; L3 is a
 * mock LLM (interface only, no real model).
 */
@Module({
  providers: [
    L1RuleClassifier,
    {
      provide: L2_CLASSIFIER,
      useFactory: () => {
        const classifier = new L2EmbeddingClassifierImpl();
        classifier.train(DEFAULT_TRAINING_SAMPLES);
        return classifier;
      },
    },
    { provide: L3_CLASSIFIER, useClass: MockL3Classifier },
    ClassificationPipelineService,
  ],
  exports: [ClassificationPipelineService, L1RuleClassifier],
})
export class ClassificationModule {}
