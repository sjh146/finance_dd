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

    // Persist via findFirst-then-create (idempotent per business+taxType+period).
    const existing = await this.prisma.taxPrediction.findFirst({
      where: { businessId, taxType: 'VAT', period },
    });

    const data = {
      businessId,
      taxType: 'VAT' as const,
      period,
      lo: prediction.lo,
      hi: prediction.hi,
      base: prediction.base,
      model: VatRuleTemplate.VERSION,
      dueDate: prediction.dueDate,
    };

    if (existing) {
      await this.prisma.taxPrediction.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.taxPrediction.create({ data });
    }

    return prediction;
  }
}
