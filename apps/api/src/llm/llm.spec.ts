import { Test, TestingModule } from '@nestjs/testing';
import { DataSensitivity } from '@prisma/client';
import { MockLlmGateway } from './mock-llm.gateway';
import { RegionalRoutingPolicy } from './regional-routing.policy';

describe('RegionalRoutingPolicy', () => {
  let policy: RegionalRoutingPolicy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RegionalRoutingPolicy],
    }).compile();
    policy = module.get(RegionalRoutingPolicy);
  });

  it('routes FINANCIAL_SENSITIVE → domestic (국내 강제)', () => {
    expect(policy.route(DataSensitivity.FINANCIAL_SENSITIVE)).toBe('domestic');
  });

  it('routes PERSONAL → domestic (국내 우선)', () => {
    expect(policy.route(DataSensitivity.PERSONAL)).toBe('domestic');
  });

  it('routes GENERAL → any (자유)', () => {
    expect(policy.route(DataSensitivity.GENERAL)).toBe('any');
  });
});

describe('MockLlmGateway', () => {
  let gateway: MockLlmGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RegionalRoutingPolicy, MockLlmGateway],
    }).compile();
    gateway = module.get(MockLlmGateway);
  });

  it('returns a deterministic response', async () => {
    const response = await gateway.complete(
      '분류해줘',
      DataSensitivity.GENERAL,
    );
    expect(response.text).toBe('[mock-llm] 분류해줘');
    expect(response.model).toBe('mock-llm-v1');
  });

  it('FINANCIAL_SENSITIVE always routes to domestic', async () => {
    await gateway.complete('거래 분류', DataSensitivity.FINANCIAL_SENSITIVE);
    await gateway.complete('거래 분류', DataSensitivity.FINANCIAL_SENSITIVE);
    const financialLogs = gateway.routingLog.filter(
      (l) => l.sensitivity === DataSensitivity.FINANCIAL_SENSITIVE,
    );
    expect(financialLogs).toHaveLength(2);
    expect(
      financialLogs.every((l) => l.routing === 'domestic'),
    ).toBe(true);
  });

  it('records routing decisions for each request', async () => {
    await gateway.complete('a', DataSensitivity.GENERAL);
    await gateway.complete('b', DataSensitivity.PERSONAL);
    expect(gateway.routingLog).toEqual([
      { sensitivity: DataSensitivity.GENERAL, routing: 'any' },
      { sensitivity: DataSensitivity.PERSONAL, routing: 'domestic' },
    ]);
  });
});
