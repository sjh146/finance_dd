import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TaxPredictionService } from './tax-prediction.service';
import { VatRuleTemplate } from './vat-rule.template';

/** Minimal mock of the PrismaService surface used by TaxPredictionService. */
function mockPrisma() {
  return {
    taxPrediction: {
      upsert: jest.fn(),
    },
  };
}

describe('TaxPredictionService', () => {
  let service: TaxPredictionService;
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(async () => {
    prisma = mockPrisma();
    prisma.taxPrediction.upsert.mockResolvedValue({ id: 'pred-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VatRuleTemplate,
        { provide: PrismaService, useValue: prisma },
        TaxPredictionService,
      ],
    }).compile();
    service = module.get(TaxPredictionService);
  });

  it('persists via atomic upsert keyed on the unique (businessId, taxType, period)', async () => {
    await service.predictVat('biz-1', '2026-Q1', { supplyValue: 10_000_000 });

    expect(prisma.taxPrediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId_taxType_period: {
            businessId: 'biz-1',
            taxType: 'VAT',
            period: '2026-Q1',
          },
        },
        create: expect.objectContaining({
          businessId: 'biz-1',
          taxType: 'VAT',
          period: '2026-Q1',
          base: 1_000_000,
        }),
        update: expect.objectContaining({
          base: 1_000_000,
          model: VatRuleTemplate.VERSION,
        }),
      }),
    );
  });

  it('returns the computed prediction', async () => {
    const result = await service.predictVat('biz-1', '2026-Q1', {
      supplyValue: 10_000_000,
    });

    expect(result.base).toBe(1_000_000);
    expect(result.lo).toBe(900_000);
    expect(result.hi).toBe(1_100_000);
    expect(result.confidence).toBe(0.9);
  });

  it('does not use the non-atomic findFirst-then-create/update sequence', async () => {
    await service.predictVat('biz-1', '2026-Q1', { supplyValue: 100 });

    // The TOCTOU-prone findFirst/create/update calls must never be used.
    expect(prisma.taxPrediction.findFirst).toBeUndefined();
    expect(prisma.taxPrediction.create).toBeUndefined();
    expect(prisma.taxPrediction.update).toBeUndefined();
  });

  it('handles concurrent calls for the same key via a single atomic upsert each', async () => {
    // Simulate N concurrent predictVat calls for the same (businessId, taxType,
    // period). Each call must go through the atomic upsert path; the DB unique
    // constraint guarantees only one row survives regardless of interleaving.
    const N = 30;
    await Promise.all(
      Array.from({ length: N }, () =>
        service.predictVat('biz-1', '2026-Q1', { supplyValue: 10_000_000 }),
      ),
    );

    expect(prisma.taxPrediction.upsert).toHaveBeenCalledTimes(N);
    // Every call targets the same unique key.
    for (const call of prisma.taxPrediction.upsert.mock.calls) {
      expect(call[0].where).toEqual({
        businessId_taxType_period: {
          businessId: 'biz-1',
          taxType: 'VAT',
          period: '2026-Q1',
        },
      });
    }
  });
});
