import { DataSensitivity } from '@prisma/client';
import { RoutingDecision } from './regional-routing.policy';

/**
 * LlmOptions — optional parameters for a completion request.
 */
export interface LlmOptions {
  /** 최대 토큰 수 */
  maxTokens?: number;
  /** 온도 */
  temperature?: number;
}

/**
 * LlmResponse — the result of a completion request.
 */
export interface LlmResponse {
  /** 생성 텍스트 */
  text: string;
  /** 사용된 라우팅 결정 */
  routing: RoutingDecision;
  /** 사용된 모델 (mock 표시) */
  model: string;
}

/**
 * LlmGateway — regional-routing-aware LLM gateway (TECH §3.1).
 * `complete(prompt, sensitivity, options)` routes based on data sensitivity.
 */
export interface LlmGateway {
  complete(
    prompt: string,
    sensitivity: DataSensitivity,
    options?: LlmOptions,
  ): Promise<LlmResponse>;
}
