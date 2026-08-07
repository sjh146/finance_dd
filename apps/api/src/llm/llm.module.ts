import { Module } from '@nestjs/common';
import { MockLlmGateway } from './mock-llm.gateway';
import { RegionalRoutingPolicy } from './regional-routing.policy';

/**
 * LlmModule — regional-routing LLM gateway (TECH §3.1).
 * Exposes the routing policy and the mock gateway.
 */
@Module({
  providers: [RegionalRoutingPolicy, MockLlmGateway],
  exports: [RegionalRoutingPolicy, MockLlmGateway],
})
export class LlmModule {}
