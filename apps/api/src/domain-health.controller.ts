import { Controller, Get } from '@nestjs/common';
import { ClassificationPipelineService } from './classification/classification-pipeline.service';
import { VatRuleTemplate } from './prediction/vat-rule.template';
import { ClosingChecklistService } from './closing/closing-checklist.service';
import { MockLlmGateway } from './llm/mock-llm.gateway';
import { DataSensitivity } from '@prisma/client';

/**
 * DomainHealthController — smoke-test endpoint that exercises the domain
 * pipeline end-to-end (classification → VAT prediction → closing checklist →
 * LLM routing) and returns a summary. No external calls; all mocks.
 */
@Controller('api/domain')
export class DomainHealthController {
  constructor(
    private readonly classification: ClassificationPipelineService,
    private readonly closing: ClosingChecklistService,
    private readonly llm: MockLlmGateway,
  ) {}

  @Get('health')
  async health(): Promise<Record<string, unknown>> {
    const classification = await this.classification.classify({
      summary: '개발 용역 대금',
      amount: 5_500_000,
    });

    const vat = new VatRuleTemplate().predict(
      { supplyValue: 10_000_000 },
      '2026-Q1',
    );

    const checklist = this.closing.detectMissingItems({
      transactionCount: 3,
      revenue: 5_500_000,
      purchases: 320_000,
      expenses: 27_800,
      hasPayroll: true,
      hasTaxPayment: false,
    });

    const llm = await this.llm.complete(
      '거래 분류 요약',
      DataSensitivity.FINANCIAL_SENSITIVE,
    );

    return {
      status: 'ok',
      classification,
      vat: {
        base: vat.base,
        lo: vat.lo,
        hi: vat.hi,
        dueDate: vat.dueDate.toISOString(),
      },
      checklist,
      llm: { text: llm.text, routing: llm.routing },
    };
  }
}
