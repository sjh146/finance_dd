import { Injectable } from '@nestjs/common';
import {
  ClassificationInput,
  ClassificationResult,
} from './classification.types';

/**
 * L3LlmClassifier — LLM-based final classifier (TECH §4.1).
 * MVP: real LLM not implemented — interface + mock only.
 */
export interface L3LlmClassifier {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}

/**
 * MockL3Classifier — deterministic stub. Returns a fixed classification with a
 * justification, explicitly marked as a mock (no real LLM call).
 */
@Injectable()
export class MockL3Classifier implements L3LlmClassifier {
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    return {
      account: '기타비용',
      confidence: 0.7,
      level: 'L3',
      justification: `L3 LLM (mock): "${input.summary}" → 기타비용`,
    };
  }
}
