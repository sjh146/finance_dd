import { Test, TestingModule } from '@nestjs/testing';
import {
  ClassificationPipelineService,
  L2_CLASSIFIER,
  L3_CLASSIFIER,
} from './classification-pipeline.service';
import { L1RuleClassifier } from './l1-rule.classifier';
import { MockL2Classifier } from './l2-embedding.classifier';
import { MockL3Classifier } from './l3-llm.classifier';

describe('L1RuleClassifier', () => {
  let classifier: L1RuleClassifier;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [L1RuleClassifier],
    }).compile();
    classifier = module.get(L1RuleClassifier);
  });

  it('maps 개발 용역 → 매출', () => {
    const result = classifier.classify({
      summary: '개발 용역 대금',
      amount: 5_500_000,
    });
    expect(result.account).toBe('매출');
    expect(result.level).toBe('L1');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('maps AWS/클라우드 → 지급수수료', () => {
    const result = classifier.classify({
      summary: 'AWS 클라우드 이용료',
      amount: -320_000,
    });
    expect(result.account).toBe('지급수수료');
  });

  it('maps 식비 → 복리후생비', () => {
    const result = classifier.classify({
      summary: '점심 식비',
      amount: -18_000,
    });
    expect(result.account).toBe('복리후생비');
  });

  it('maps 교통 → 여비교통비', () => {
    const result = classifier.classify({
      summary: '고속도로 통행료',
      amount: -9_800,
    });
    expect(result.account).toBe('여비교통비');
  });

  it('signals fallthrough (low confidence) for unknown merchant', () => {
    const result = classifier.classify({
      summary: '기타 잡비 지출',
      amount: -5_000,
    });
    expect(result.confidence).toBeLessThan(L1RuleClassifier.THRESHOLD);
    expect(result.account).toBe('미분류');
  });
});

describe('ClassificationPipelineService', () => {
  let pipeline: ClassificationPipelineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        L1RuleClassifier,
        { provide: L2_CLASSIFIER, useClass: MockL2Classifier },
        { provide: L3_CLASSIFIER, useClass: MockL3Classifier },
        ClassificationPipelineService,
      ],
    }).compile();
    pipeline = module.get(ClassificationPipelineService);
  });

  it('returns L1 result when confidence is high', async () => {
    const result = await pipeline.classify({
      summary: '개발 용역 대금',
      amount: 5_500_000,
    });
    expect(result.level).toBe('L1');
    expect(result.account).toBe('매출');
  });

  it('falls through L1 → L2 → L3 for unknown input', async () => {
    const result = await pipeline.classify({
      summary: '기타 잡비 지출',
      amount: -5_000,
    });
    expect(result.level).toBe('L3');
    expect(result.account).toBe('기타비용');
    expect(result.justification).toContain('mock');
  });
});
