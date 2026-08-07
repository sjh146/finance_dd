import { Injectable } from '@nestjs/common';
import { DataSensitivity } from '@prisma/client';
import { LlmGateway, LlmOptions, LlmResponse } from './llm-gateway.interface';
import { RegionalRoutingPolicy } from './regional-routing.policy';

/**
 * MockLlmGateway — deterministic LLM gateway stub. No real LLM call.
 * Records the routing decision for each request so tests can assert that
 * FINANCIAL_SENSITIVE always routes to 'domestic'.
 */
@Injectable()
export class MockLlmGateway implements LlmGateway {
  /** 기록된 라우팅 결정 (테스트 검증용) */
  readonly routingLog: Array<{ sensitivity: DataSensitivity; routing: string }> =
    [];

  constructor(private readonly policy: RegionalRoutingPolicy) {}

  async complete(
    prompt: string,
    sensitivity: DataSensitivity,
    _options?: LlmOptions,
  ): Promise<LlmResponse> {
    const routing = this.policy.route(sensitivity);
    this.routingLog.push({ sensitivity, routing });

    return {
      text: `[mock-llm] ${prompt}`,
      routing,
      model: 'mock-llm-v1',
    };
  }
}
