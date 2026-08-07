import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { IngestProcessor, IngestJobData } from './ingest.processor';
import { OcrProcessor, OcrJobData } from './ocr.processor';
import { ClassifyProcessor, ClassifyJobData } from './classify.processor';
import { PredictProcessor, PredictJobData } from './predict.processor';
import { NotifyProcessor, NotifyJobData } from './notify.processor';
import { PipelineOrchestratorService } from './pipeline-orchestrator.service';
import {
  PIPELINE_ATTEMPTS,
  QUEUE_CLASSIFY,
  QUEUE_INGEST,
  QUEUE_NOTIFY,
  QUEUE_OCR,
  QUEUE_PREDICT,
  redisConnection,
} from './pipeline.constants';
import { TransactionAdapterFactory } from '../adapters/transaction-adapter.factory';
import { MockBankApiAdapter, MockMyDataAdapter } from '../adapters/mock-adapters';
import { OcrService, OCR_PIPELINE } from '../ocr/ocr.service';
import { MockOcrPipeline } from '../ocr/mock-ocr.pipeline';
import {
  ClassificationPipelineService,
  L2_CLASSIFIER,
  L3_CLASSIFIER,
} from '../classification/classification-pipeline.service';
import { L1RuleClassifier } from '../classification/l1-rule.classifier';
import { MockL2Classifier } from '../classification/l2-embedding.classifier';
import { MockL3Classifier } from '../classification/l3-llm.classifier';
import { TaxPredictionService } from '../prediction/tax-prediction.service';
import { VatRuleTemplate } from '../prediction/vat-rule.template';
import { ClosingChecklistService } from '../closing/closing-checklist.service';

/** Minimal mock of the PrismaService surface used by the processors. */
function mockPrisma() {
  return {
    transaction: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    voucher: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    voucherLine: {
      create: jest.fn(),
    },
    classification: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    taxPrediction: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    business: {
      findUnique: jest.fn(),
    },
    ledger: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    notification: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
}

/** Minimal mock of a BullMQ Queue. */
function mockQueue() {
  return {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getDelayedCount: jest.fn().mockResolvedValue(0),
  };
}

/** Build a minimal Job object with the fields the processors touch. */
function makeJob<T>(data: T, overrides: Partial<Job> = {}): Job<T> {
  return {
    data,
    id: 'job-1',
    attemptsMade: 0,
    updateProgress: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Job<T>;
}

describe('pipeline.constants', () => {
  it('defines the 5 pipeline queues in order', () => {
    expect([
      QUEUE_INGEST,
      QUEUE_OCR,
      QUEUE_CLASSIFY,
      QUEUE_PREDICT,
      QUEUE_NOTIFY,
    ]).toEqual([
      'ingest-queue',
      'ocr-queue',
      'classify-queue',
      'predict-queue',
      'notify-queue',
    ]);
  });

  it('defaults retry attempts to 3', () => {
    expect(PIPELINE_ATTEMPTS).toBe(3);
  });

  it('resolves Redis connection from REDIS_URL (default localhost:6379)', () => {
    const prev = process.env['REDIS_URL'];
    delete process.env['REDIS_URL'];
    expect(redisConnection()).toEqual({ url: 'redis://localhost:6379' });
    process.env['REDIS_URL'] = 'redis://custom:6380';
    expect(redisConnection()).toEqual({ url: 'redis://custom:6380' });
    if (prev === undefined) {
      delete process.env['REDIS_URL'];
    } else {
      process.env['REDIS_URL'] = prev;
    }
  });
});

describe('IngestProcessor', () => {
  let processor: IngestProcessor;
  let prisma: ReturnType<typeof mockPrisma>;
  let classifyQueue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    prisma = mockPrisma();
    classifyQueue = mockQueue();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MockMyDataAdapter,
        MockBankApiAdapter,
        TransactionAdapterFactory,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(QUEUE_CLASSIFY), useValue: classifyQueue },
        IngestProcessor,
      ],
    }).compile();
    processor = module.get(IngestProcessor);
  });

  it('fetches transactions, persists them, and chains classify jobs', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);
    prisma.voucher.findFirst.mockResolvedValue({ id: 'voucher-1' });
    prisma.transaction.create.mockImplementation(async (args: { data: { finNo: string } }) => ({
      id: `txn-${args.data.finNo}`,
    }));
    prisma.voucherLine.create.mockResolvedValue({ id: 'line-1' });

    const job = makeJob<IngestJobData>({
      consent: { id: 'c1', type: 'mydata', scope: 's', status: 'ACTIVE' },
      ledgerId: 'ledger-1',
      businessId: 'biz-1',
      period: '2026-Q1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.000Z',
    });

    const result = await processor.process(job);

    // 4 sample transactions ingested.
    expect(result.ingested).toBe(4);
    expect(result.classified).toBe(4);
    expect(prisma.transaction.create).toHaveBeenCalledTimes(4);
    // One classify job chained per ingested transaction.
    expect(classifyQueue.add).toHaveBeenCalledTimes(4);
    expect(classifyQueue.add).toHaveBeenCalledWith(
      'classify-transaction',
      expect.objectContaining({ businessId: 'biz-1', period: '2026-Q1' }),
    );
    // Progress updated to 100.
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('skips already-ingested transactions (idempotent)', async () => {
    prisma.transaction.findFirst.mockResolvedValue({ id: 'existing' });
    prisma.voucher.findFirst.mockResolvedValue({ id: 'voucher-1' });

    const job = makeJob<IngestJobData>({
      consent: { id: 'c1', type: 'mydata', scope: 's', status: 'ACTIVE' },
      ledgerId: 'ledger-1',
      businessId: 'biz-1',
      period: '2026-Q1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.000Z',
    });

    const result = await processor.process(job);

    expect(result.ingested).toBe(0);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(classifyQueue.add).not.toHaveBeenCalled();
  });
});

describe('OcrProcessor', () => {
  let processor: OcrProcessor;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    prisma.transaction.create.mockResolvedValue({ id: 'txn-ocr' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OCR_PIPELINE, useClass: MockOcrPipeline },
        OcrService,
        { provide: PrismaService, useValue: prisma },
        OcrProcessor,
      ],
    }).compile();
    processor = module.get(OcrProcessor);
  });

  it('extracts a receipt and persists it as an expense transaction', async () => {
    const job = makeJob<OcrJobData>({
      imageBase64: Buffer.from('fake-image').toString('base64'),
      ledgerId: 'ledger-1',
    });

    const result = await processor.process(job);

    expect(result.extracted).toBe(true);
    expect(result.amount).toBe(14500);
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: -14500, provider: 'CARD' }),
      }),
    );
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });
});

describe('ClassifyProcessor', () => {
  let processor: ClassifyProcessor;
  let prisma: ReturnType<typeof mockPrisma>;
  let predictQueue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    prisma = mockPrisma();
    predictQueue = mockQueue();
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'txn-1',
      summary: '개발 용역 대금',
      amount: 5500000,
    });
    prisma.classification.findFirst.mockResolvedValue(null);
    prisma.classification.create.mockResolvedValue({ id: 'class-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        L1RuleClassifier,
        { provide: L2_CLASSIFIER, useClass: MockL2Classifier },
        { provide: L3_CLASSIFIER, useClass: MockL3Classifier },
        ClassificationPipelineService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(QUEUE_PREDICT), useValue: predictQueue },
        ClassifyProcessor,
      ],
    }).compile();
    processor = module.get(ClassifyProcessor);
  });

  it('classifies via L1 and persists Classification history', async () => {
    const job = makeJob<ClassifyJobData>({
      transactionId: 'txn-1',
      voucherId: 'voucher-1',
      lineId: 'line-1',
      businessId: 'biz-1',
      period: '2026-Q1',
    });

    const result = await processor.process(job);

    expect(result.account).toBe('매출');
    expect(result.level).toBe('L1');
    expect(prisma.classification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level: 'L1',
          model: 'rule:industry-dictionary',
          confidence: 0.95,
        }),
      }),
    );
    // Chains a predict job.
    expect(predictQueue.add).toHaveBeenCalledWith(
      'predict-vat',
      expect.objectContaining({ businessId: 'biz-1', period: '2026-Q1' }),
    );
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('throws when the transaction is missing (triggers retry)', async () => {
    prisma.transaction.findUnique.mockResolvedValue(null);
    const job = makeJob<ClassifyJobData>({
      transactionId: 'missing',
      voucherId: 'voucher-1',
      lineId: 'line-1',
      businessId: 'biz-1',
      period: '2026-Q1',
    });

    await expect(processor.process(job)).rejects.toThrow(
      'transaction not found',
    );
    expect(predictQueue.add).not.toHaveBeenCalled();
  });
});

describe('PredictProcessor', () => {
  let processor: PredictProcessor;
  let prisma: ReturnType<typeof mockPrisma>;
  let notifyQueue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    prisma = mockPrisma();
    notifyQueue = mockQueue();
    prisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      memberId: 'member-1',
    });
    prisma.taxPrediction.findFirst.mockResolvedValue(null);
    prisma.taxPrediction.create.mockResolvedValue({ id: 'pred-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VatRuleTemplate,
        { provide: PrismaService, useValue: prisma },
        TaxPredictionService,
        { provide: getQueueToken(QUEUE_NOTIFY), useValue: notifyQueue },
        PredictProcessor,
      ],
    }).compile();
    processor = module.get(PredictProcessor);
  });

  it('runs the VAT rule template and chains a notify job', async () => {
    const job = makeJob<PredictJobData>({
      businessId: 'biz-1',
      period: '2026-Q1',
      supplyValue: 10000000,
    });

    const result = await processor.process(job);

    expect(result.base).toBe(1000000);
    expect(prisma.taxPrediction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz-1',
          taxType: 'VAT',
          period: '2026-Q1',
          base: 1000000,
        }),
      }),
    );
    expect(notifyQueue.add).toHaveBeenCalledWith(
      'notify-deadline',
      expect.objectContaining({
        memberId: 'member-1',
        businessId: 'biz-1',
        period: '2026-Q1',
        taxType: 'VAT',
      }),
    );
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('aggregates supply value from the DB when not provided', async () => {
    prisma.ledger.findMany.mockResolvedValue([
      {
        transactions: [
          { amount: 5500000 },
          { amount: -320000 },
          { amount: 2000000 },
        ],
      },
    ]);

    const job = makeJob<PredictJobData>({
      businessId: 'biz-1',
      period: '2026-Q1',
    });

    const result = await processor.process(job);

    // supply = 5500000 + 2000000 = 7500000 → base = 750000
    expect(result.base).toBe(750000);
    expect(prisma.ledger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', period: '2026-Q1' },
      }),
    );
  });
});

describe('NotifyProcessor', () => {
  let processor: NotifyProcessor;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    prisma.ledger.findFirst.mockResolvedValue({
      transactions: [
        { amount: 5500000 },
        { amount: -320000 },
        { amount: -18000 },
      ],
    });
    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: 'notif-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        ClosingChecklistService,
        NotifyProcessor,
      ],
    }).compile();
    processor = module.get(NotifyProcessor);
  });

  it('generates a deadline notification from the closing checklist', async () => {
    const job = makeJob<NotifyJobData>({
      memberId: 'member-1',
      businessId: 'biz-1',
      period: '2026-Q1',
      dueDate: '2026-04-25T00:00:00.000Z',
      taxType: 'VAT',
    });

    const result = await processor.process(job);

    expect(result.notifications).toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberId: 'member-1',
          kind: 'PAYMENT',
          channel: 'IN_APP',
          title: 'VAT 2026-Q1 신고기한 임박',
        }),
      }),
    );
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('does not duplicate an existing notification (idempotent)', async () => {
    prisma.notification.findFirst.mockResolvedValue({ id: 'existing' });
    const job = makeJob<NotifyJobData>({
      memberId: 'member-1',
      businessId: 'biz-1',
      period: '2026-Q1',
      dueDate: '2026-04-25T00:00:00.000Z',
      taxType: 'VAT',
    });

    const result = await processor.process(job);

    expect(result.notifications).toBe(0);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

describe('PipelineOrchestratorService', () => {
  let orchestrator: PipelineOrchestratorService;
  let ingestQueue: ReturnType<typeof mockQueue>;
  let classifyQueue: ReturnType<typeof mockQueue>;
  let predictQueue: ReturnType<typeof mockQueue>;
  let notifyQueue: ReturnType<typeof mockQueue>;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    ingestQueue = mockQueue();
    classifyQueue = mockQueue();
    predictQueue = mockQueue();
    notifyQueue = mockQueue();
    prisma = mockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: getQueueToken(QUEUE_INGEST), useValue: ingestQueue },
        { provide: getQueueToken(QUEUE_CLASSIFY), useValue: classifyQueue },
        { provide: getQueueToken(QUEUE_PREDICT), useValue: predictQueue },
        { provide: getQueueToken(QUEUE_NOTIFY), useValue: notifyQueue },
        { provide: PrismaService, useValue: prisma },
        PipelineOrchestratorService,
      ],
    }).compile();
    orchestrator = module.get(PipelineOrchestratorService);
  });

  it('syncAndProcess enqueues the ingest job', async () => {
    const result = await orchestrator.syncAndProcess({
      businessId: 'biz-1',
      ledgerId: 'ledger-1',
      period: '2026-Q1',
      consent: { id: 'c1', type: 'mydata', scope: 's', status: 'ACTIVE' },
    });

    expect(result.ingestJobId).toBe('job-1');
    expect(ingestQueue.add).toHaveBeenCalledWith(
      'ingest-transactions',
      expect.objectContaining({
        businessId: 'biz-1',
        ledgerId: 'ledger-1',
        period: '2026-Q1',
      }),
    );
    expect(result.queues).toContain(QUEUE_INGEST);
  });

  it('enqueueClassify / enqueuePredict / enqueueNotify chain forward', async () => {
    await orchestrator.enqueueClassify({
      transactionId: 't1',
      voucherId: 'v1',
      lineId: 'l1',
    });
    expect(classifyQueue.add).toHaveBeenCalledWith('classify-transaction', {
      transactionId: 't1',
      voucherId: 'v1',
      lineId: 'l1',
    });

    await orchestrator.enqueuePredict({
      businessId: 'b1',
      period: '2026-Q1',
      supplyValue: 100,
    });
    expect(predictQueue.add).toHaveBeenCalledWith('predict-vat', {
      businessId: 'b1',
      period: '2026-Q1',
      supplyValue: 100,
    });

    await orchestrator.enqueueNotify({
      memberId: 'm1',
      businessId: 'b1',
      period: '2026-Q1',
      dueDate: '2026-04-25T00:00:00.000Z',
    });
    expect(notifyQueue.add).toHaveBeenCalledWith('notify-deadline', {
      memberId: 'm1',
      businessId: 'b1',
      period: '2026-Q1',
      dueDate: '2026-04-25T00:00:00.000Z',
    });
  });
});
