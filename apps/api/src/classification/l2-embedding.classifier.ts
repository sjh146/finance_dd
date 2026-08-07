import { Injectable } from '@nestjs/common';
import {
  ClassificationInput,
  ClassificationResult,
} from './classification.types';

/**
 * L2EmbeddingClassifier — local embedding-based classifier (TECH §4.1).
 * MVP: embedding model not implemented — this is a stub that returns a
 * low-confidence result and delegates to L3.
 */
export interface L2EmbeddingClassifier {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}

/**
 * MockL2Classifier — stub implementation. Returns a low-confidence result
 * (below threshold) so the pipeline falls through to L3.
 */
@Injectable()
export class MockL2Classifier implements L2EmbeddingClassifier {
  async classify(_input: ClassificationInput): Promise<ClassificationResult> {
    return {
      account: '미분류',
      confidence: 0.2,
      level: 'L2',
      justification: 'L2 임베딩 미구현 (stub) — L3로 하강',
    };
  }
}
