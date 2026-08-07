import { Module } from '@nestjs/common';
import { TaxPredictionService } from './tax-prediction.service';
import { VatRuleTemplate } from './vat-rule.template';

/**
 * PredictionModule — tax prediction (VAT rule template + persistence).
 */
@Module({
  providers: [VatRuleTemplate, TaxPredictionService],
  exports: [TaxPredictionService, VatRuleTemplate],
})
export class PredictionModule {}
