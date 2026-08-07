import { Test, TestingModule } from '@nestjs/testing';
import {
  ClassificationPipelineService,
  L2_CLASSIFIER,
  L3_CLASSIFIER,
} from './classification-pipeline.service';
import { L1RuleClassifier } from './l1-rule.classifier';
import {
  L2_CONFIDENCE_THRESHOLD,
  L2EmbeddingClassifierImpl,
  MockL2Classifier,
  TrainingSample,
} from './l2-embedding.classifier';
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

describe('L2EmbeddingClassifierImpl', () => {
  const trainingSamples: TrainingSample[] = [
    { summary: '개발 용역 대금', merchant: '고객사', amount: 5_500_000, account: '매출' },
    { summary: 'AWS 클라우드 이용료', merchant: 'Amazon', amount: -320_000, account: '지급수수료' },
    { summary: '점심 식비', merchant: '식당', amount: -18_000, account: '복리후생비' },
    { summary: '고속도로 통행료', merchant: '한국도로공사', amount: -9_800, account: '여비교통비' },
  ];

  let classifier: L2EmbeddingClassifierImpl;

  beforeEach(() => {
    classifier = new L2EmbeddingClassifierImpl();
    classifier.train(trainingSamples);
  });

  it('classifies a similar transaction to the learned account', async () => {
    const result = await classifier.classify({
      summary: '개발 용역비',
      merchant: '고객사',
      amount: 6_000_000,
    });
    expect(result.level).toBe('L2');
    expect(result.account).toBe('매출');
    expect(result.confidence).toBeGreaterThanOrEqual(L2_CONFIDENCE_THRESHOLD);
  });

  it('classifies a similar cloud expense to 지급수수료', async () => {
    const result = await classifier.classify({
      summary: 'AWS 서버 이용료',
      merchant: 'Amazon',
      amount: -300_000,
    });
    expect(result.level).toBe('L2');
    expect(result.account).toBe('지급수수료');
    expect(result.confidence).toBeGreaterThanOrEqual(L2_CONFIDENCE_THRESHOLD);
  });

  it('falls through (low confidence) for an unrelated transaction', async () => {
    const result = await classifier.classify({
      summary: '해외 여행 항공권',
      merchant: '대한항공',
      amount: -1_200_000,
    });
    expect(result.level).toBe('L2');
    expect(result.account).toBe('미분류');
    expect(result.confidence).toBeLessThan(L2_CONFIDENCE_THRESHOLD);
  });

  it('returns low confidence when no training data exists', async () => {
    const untrained = new L2EmbeddingClassifierImpl();
    const result = await untrained.classify({
      summary: '개발 용역 대금',
      amount: 5_500_000,
    });
    expect(result.level).toBe('L2');
    expect(result.account).toBe('미분류');
    expect(result.confidence).toBe(0);
  });
});

describe('ClassificationPipelineService with real L2', () => {
  let pipeline: ClassificationPipelineService;

  beforeEach(async () => {
    const l2 = new L2EmbeddingClassifierImpl();
    l2.train([
      { summary: '온라인 광고비', merchant: '구글', amount: -500_000, account: '광고선전비' },
      { summary: '디지털 마케팅 광고', merchant: '메타', amount: -800_000, account: '광고선전비' },
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        L1RuleClassifier,
        { provide: L2_CLASSIFIER, useValue: l2 },
        { provide: L3_CLASSIFIER, useClass: MockL3Classifier },
        ClassificationPipelineService,
      ],
    }).compile();
    pipeline = module.get(ClassificationPipelineService);
  });

  it('returns L2 result when L1 fails but L2 is confident', async () => {
    const result = await pipeline.classify({
      summary: '온라인 광고 집행비',
      merchant: '구글',
      amount: -520_000,
    });
    expect(result.level).toBe('L2');
    expect(result.account).toBe('광고선전비');
  });

  it('falls through to L3 when both L1 and L2 are not confident', async () => {
    const result = await pipeline.classify({
      summary: '해외 여행 항공권',
      merchant: '대한항공',
      amount: -1_200_000,
    });
    expect(result.level).toBe('L3');
    expect(result.account).toBe('기타비용');
  });
});
