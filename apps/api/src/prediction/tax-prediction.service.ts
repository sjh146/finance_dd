import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  VatPrediction,
  VatPredictionInput,
  VatRuleTemplate,
} from './vat-rule.template';

/**
 * TaxPredictionService — uses the VAT rule template and persists predictions
 * to the DB via Prisma (TaxPrediction entity).
 */
@Injectable()
export class TaxPredictionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Predict VAT for a business/period and persist the result.
   */
  async predictVat(
    businessId: string,
    period: string,
    input: VatPredictionInput,
  ): Promise<VatPrediction> {
    const prediction = new VatRuleTemplate().predict(input, period);

    // Persist atomically via upsert keyed on the (businessId, taxType, period)
    // unique constraint. This replaces the previous findFirst-then-create/update
    // sequence, which was vulnerable to a TOCTOU race (CWE-362): concurrent
    // calls for the same key could both observe "no existing row" and create
    // duplicate rows. upsert is atomic, so exactly one row exists per key.
    await this.prisma.taxPrediction.upsert({
      where: {
        businessId_taxType_period: { businessId, taxType: 'VAT', period },
      },
      update: {
        lo: prediction.lo,
        hi: prediction.hi,
        base: prediction.base,
        model: VatRuleTemplate.VERSION,
        dueDate: prediction.dueDate,
      },
      create: {
        businessId,
        taxType: 'VAT' as const,
        period,
        lo: prediction.lo,
        hi: prediction.hi,
        base: prediction.base,
        model: VatRuleTemplate.VERSION,
        dueDate: prediction.dueDate,
      },
    });

    return prediction;
  }
}
