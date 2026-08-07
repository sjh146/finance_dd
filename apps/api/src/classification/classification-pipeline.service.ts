import { Inject, Injectable } from '@nestjs/common';
import {
  ClassificationInput,
  ClassificationResult,
} from './classification.types';
import { L1RuleClassifier } from './l1-rule.classifier';
import { L2_CONFIDENCE_THRESHOLD } from './l2-embedding.classifier';
import type { L2EmbeddingClassifier } from './l2-embedding.classifier';
import type { L3LlmClassifier } from './l3-llm.classifier';

/** DI token for the L2 embedding classifier implementation. */
export const L2_CLASSIFIER = Symbol('L2_CLASSIFIER');
/** DI token for the L3 LLM classifier implementation. */
export const L3_CLASSIFIER = Symbol('L3_CLASSIFIER');

/**
 * ClassificationPipelineService — orchestrates the 3-stage cascade
 * (TECH §4.1): L1 규칙 → L2 임베딩 → L3 LLM.
 *
 * - If L1 confidence >= threshold, return the L1 result immediately.
 * - Otherwise fall through to L2, then L3.
 * - Returns the final result with the level actually used.
 */
@Injectable()
export class ClassificationPipelineService {
  constructor(
    private readonly l1: L1RuleClassifier,
    @Inject(L2_CLASSIFIER) private readonly l2: L2EmbeddingClassifier,
    @Inject(L3_CLASSIFIER) private readonly l3: L3LlmClassifier,
  ) {}

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const l1Result = this.l1.classify(input);

    if (l1Result.confidence >= L1RuleClassifier.THRESHOLD) {
      return l1Result;
    }

    const l2Result = await this.l2.classify(input);
    if (l2Result.confidence >= L2_CONFIDENCE_THRESHOLD) {
      return l2Result;
    }

    return this.l3.classify(input);
  }
}
