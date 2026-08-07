import { Injectable } from '@nestjs/common';
import {
  ClassificationInput,
  ClassificationResult,
} from './classification.types';

/**
 * L2EmbeddingClassifier — local embedding-based classifier (TECH §4.1).
 *
 * Pure TypeScript, no external ML/LLM dependency. It builds a lightweight
 * feature vector per training sample using character n-grams + a hashing
 * vectorizer with TF-IDF-style weighting, then classifies a new transaction
 * by cosine similarity against the learned history.
 *
 * The classifier is trained from past classification history (거래처, 적요,
 * 금액 범위, 업종). When no history is available, or the best match is below
 * the confidence threshold, it returns a low-confidence result so the pipeline
 * falls through to L3 (LLM).
 */
export interface L2EmbeddingClassifier {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}

/** A single labeled training sample derived from past classification history. */
export interface TrainingSample {
  /** 거래·적요 */
  summary: string;
  /** 거래처/가맹점 (optional) */
  merchant?: string;
  /** +/- 부호 금액 */
  amount: number;
  /** 계정과목 label */
  account: string;
}

/** Confidence threshold — below this the pipeline falls through to L3. */
export const L2_CONFIDENCE_THRESHOLD = 0.5;

/** Hashing vectorizer dimension (fixed, collision-tolerant). */
const VECTOR_DIM = 256;

/** Dimension reserved for the amount-range feature (kept separate from text). */
const AMOUNT_FEATURE_DIM = 32;

/** Character n-gram sizes used for tokenization. */
const NGRAM_SIZES = [2, 3, 4];

/** Simple 32-bit string hash (FNV-1a) used by the hashing vectorizer. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Normalize text: lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenize text into character n-grams (with a whole-token fallback). */
function tokenize(text: string): string[] {
  const normalized = normalize(text);
  if (!normalized) {
    return [];
  }
  const tokens: string[] = [];
  for (const size of NGRAM_SIZES) {
    for (let i = 0; i <= normalized.length - size; i++) {
      tokens.push(normalized.slice(i, i + size));
    }
  }
  // Whole-word tokens help short summaries (e.g. merchant names).
  for (const word of normalized.split(' ')) {
    if (word.length > 0) {
      tokens.push(`w:${word}`);
    }
  }
  return tokens;
}

/** A sparse feature vector: Map<featureIndex, weight>. */
type SparseVector = Map<number, number>;

/**
 * L2EmbeddingClassifierImpl — the real local embedding classifier.
 *
 * Training: builds a per-account centroid vector by averaging the hashed
 * n-gram vectors of all samples labeled with that account. Classification:
 * computes the cosine similarity between the input vector and each account
 * centroid, then returns the best match if it clears the threshold.
 */
@Injectable()
export class L2EmbeddingClassifierImpl implements L2EmbeddingClassifier {
  /** Per-account centroid vectors (feature index → weight). */
  private centroids = new Map<string, SparseVector>();
  /** Per-account sample count (used for confidence scaling). */
  private sampleCounts = new Map<string, number>();
  /** Whether the model has been trained at least once. */
  private trained = false;

  /**
   * Train the classifier from past classification history.
   * Idempotent — calling again replaces the model with the given samples.
   */
  train(samples: TrainingSample[]): void {
    const accountVectors = new Map<string, SparseVector[]>();
    const accountCounts = new Map<string, number>();

    for (const sample of samples) {
      const vector = this.vectorize(sample);
      const list = accountVectors.get(sample.account) ?? [];
      list.push(vector);
      accountVectors.set(sample.account, list);
      accountCounts.set(sample.account, (accountCounts.get(sample.account) ?? 0) + 1);
    }

    this.centroids = new Map();
    this.sampleCounts = accountCounts;
    this.trained = samples.length > 0;

    for (const [account, vectors] of accountVectors) {
      this.centroids.set(account, this.average(vectors));
    }
  }

  /** Whether the model has training data. */
  isTrained(): boolean {
    return this.trained;
  }

  /**
   * Classify a transaction. Returns the best-matching account if its cosine
   * similarity clears the threshold; otherwise a low-confidence result that
   * signals fallthrough to L3.
   */
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    if (!this.trained) {
      return {
        account: '미분류',
        confidence: 0,
        level: 'L2',
        justification: 'L2 임베딩: 학습 이력 없음 — L3로 하강',
      };
    }

    const inputVector = this.vectorize(input);
    let bestAccount: string | null = null;
    let bestScore = 0;

    for (const [account, centroid] of this.centroids) {
      const score = this.cosine(inputVector, centroid);
      if (score > bestScore) {
        bestScore = score;
        bestAccount = account;
      }
    }

    if (bestAccount && bestScore >= L2_CONFIDENCE_THRESHOLD) {
      const count = this.sampleCounts.get(bestAccount) ?? 0;
      return {
        account: bestAccount,
        confidence: bestScore,
        level: 'L2',
        justification: `L2 임베딩: 코사인 유사도 ${bestScore.toFixed(3)} (학습 ${count}건) → ${bestAccount}`,
      };
    }

    return {
      account: '미분류',
      confidence: bestScore,
      level: 'L2',
      justification: `L2 임베딩: 최고 유사도 ${bestScore.toFixed(3)} < 임계값 — L3로 하강`,
    };
  }

  /** Build a sparse hashed n-gram vector for a sample/input. */
  private vectorize(sample: {
    summary: string;
    merchant?: string;
    amount: number;
  }): SparseVector {
    const vector = new Map<number, number>();
    const text = `${sample.summary} ${sample.merchant ?? ''}`;
    const tokens = tokenize(text);

    // Term frequency (raw count) with hashing. Whole-word tokens are more
    // discriminative, so they get a higher weight than character n-grams.
    for (const token of tokens) {
      const idx = fnv1a(token) % VECTOR_DIM;
      const weight = token.startsWith('w:') ? 3 : 1;
      vector.set(idx, (vector.get(idx) ?? 0) + weight);
    }

    // Amount range feature in a separate dimension space so it never collides
    // with text n-grams. Buckets the absolute amount on a log scale so
    // similar-sized transactions reinforce the match.
    const abs = Math.abs(sample.amount);
    if (abs > 0) {
      const bucket = Math.min(AMOUNT_FEATURE_DIM - 1, Math.floor(Math.log10(abs)));
      const amountIdx = VECTOR_DIM + bucket;
      vector.set(amountIdx, (vector.get(amountIdx) ?? 0) + 1);
    }

    return vector;
  }

  /** Average a list of sparse vectors into a centroid. */
  private average(vectors: SparseVector[]): SparseVector {
    const centroid = new Map<number, number>();
    for (const vector of vectors) {
      for (const [idx, weight] of vector) {
        centroid.set(idx, (centroid.get(idx) ?? 0) + weight);
      }
    }
    for (const [idx, weight] of centroid) {
      centroid.set(idx, weight / vectors.length);
    }
    return centroid;
  }

  /** Cosine similarity between two sparse vectors (0 when either is empty). */
  private cosine(a: SparseVector, b: SparseVector): number {
    if (a.size === 0 || b.size === 0) {
      return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const [idx, weight] of a) {
      normA += weight * weight;
      const other = b.get(idx);
      if (other !== undefined) {
        dot += weight * other;
      }
    }
    for (const [, weight] of b) {
      normB += weight * weight;
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

/**
 * MockL2Classifier — retained for backward compatibility / tests that rely on
 * the deterministic stub. New code should use L2EmbeddingClassifierImpl.
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
