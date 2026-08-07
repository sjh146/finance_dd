import { Module } from '@nestjs/common';
import {
  ClassificationPipelineService,
  L2_CLASSIFIER,
  L3_CLASSIFIER,
} from './classification-pipeline.service';
import { L1RuleClassifier } from './l1-rule.classifier';
import { MockL2Classifier } from './l2-embedding.classifier';
import { MockL3Classifier } from './l3-llm.classifier';

/**
 * ClassificationModule — 3-stage classification pipeline (L1 규칙 → L2 → L3).
 * L2/L3 are mock implementations (interfaces only, no real model/LLM).
 */
@Module({
  providers: [
    L1RuleClassifier,
    { provide: L2_CLASSIFIER, useClass: MockL2Classifier },
    { provide: L3_CLASSIFIER, useClass: MockL3Classifier },
    ClassificationPipelineService,
  ],
  exports: [ClassificationPipelineService, L1RuleClassifier],
})
export class ClassificationModule {}
