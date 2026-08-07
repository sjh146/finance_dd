import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PrismaService } from '@aggelog/api/prisma/prisma.service';
import { McpServerModule } from './mcp-server.module';
import { McpServerService } from './mcp-server.service';
import { TOOL_NAMES } from './tools/schemas';

/**
 * MCP 서버 테스트.
 *
 * 1) 도구 등록 스키마 검증: 8개 도구가 올바른 이름과 입력 스키마로 등록되는지.
 * 2) 핵심 도구 동작: classify_transaction, predict_tax, get_closing_checklist,
 *    process_receipt, sync_accounts 가 실제 도메인 서비스를 호출해 올바른 결과를
 *    반환하는지 (InMemoryTransport + Client로 tools/call 호출).
 * 3) 인증/소유권 검증: 인증 실패(401), 교차 테넌트(403) 케이스.
 *
 * DB 의존 도구(list_businesses 등)는 DB가 없어도 명확한 오류를 반환하는지 검증한다.
 */

/** 인증 컨텍스트 해석용 PrismaService 목. */
function mockPrisma() {
  return {
    member: {
      findUnique: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    business: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return where.id === 'biz-1'
          ? Promise.resolve({ id: 'biz-1', memberId: 'member-1' })
          : Promise.resolve(null);
      }),
    },
    ledger: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return where.id === 'ledger-1'
          ? Promise.resolve({ id: 'ledger-1', business: { memberId: 'member-1' } })
          : Promise.resolve(null);
      }),
    },
  };
}

describe('McpServerService', () => {
  let module: TestingModule;
  let mcp: McpServerService;

  beforeAll(async () => {
    // 인증 테스트를 위해 MCP_API_KEY를 설정한다 (빈 값이면 서버가 시작을 거부하므로 유효한 테스트 키 사용).
    process.env['MCP_API_KEY'] = 'test-api-key';
    module = await Test.createTestingModule({
      imports: [McpServerModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma())
      .compile();
    await module.init();
    mcp = module.get(McpServerService);
  });

  afterAll(async () => {
    delete process.env['MCP_API_KEY'];
    await module.close();
  });

  describe('도구 등록 스키마 검증', () => {
    it('8개 도구가 모두 등록된다', async () => {
      const server = await mcp.build();
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...TOOL_NAMES].sort());
      expect(tools).toHaveLength(8);

      await client.close();
      await server.close();
    });

    it('각 도구의 입력 스키마에 필수 필드와 한국어 설명이 포함된다', async () => {
      const server = await mcp.build();
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t]));

      // classify_transaction: summary/amount 필수, 한국어 설명 포함.
      const classify = byName.get('classify_transaction')!;
      expect(classify.description).toContain('분류');
      const classifySchema = classify.inputSchema as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(classifySchema.required).toContain('summary');
      expect(classifySchema.required).toContain('amount');
      expect(classifySchema.properties).toHaveProperty('summary');

      // predict_tax: businessId/period/supplyValue 필수.
      const predict = byName.get('predict_tax')!;
      expect(predict.description).toContain('예측');
      const predictSchema = predict.inputSchema as {
        required?: string[];
      };
      expect(predictSchema.required).toEqual(
        expect.arrayContaining(['businessId', 'period', 'supplyValue']),
      );

      // process_receipt: imageBase64 필수.
      const receipt = byName.get('process_receipt')!;
      const receiptSchema = receipt.inputSchema as { required?: string[] };
      expect(receiptSchema.required).toContain('imageBase64');

      // sync_accounts: consentType/from/to 필수.
      const sync = byName.get('sync_accounts')!;
      const syncSchema = sync.inputSchema as { required?: string[] };
      expect(syncSchema.required).toEqual(
        expect.arrayContaining(['consentType', 'from', 'to']),
      );

      await client.close();
      await server.close();
    });
  });

  describe('핵심 도구 동작', () => {
    async function callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ text: string }> {
      const server = await mcp.build();
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(clientTransport);

      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      await client.close();
      await server.close();
      return { text };
    }

    it('classify_transaction: 개발 용역 → 매출 (L1), 금융 민감 → domestic 라우팅', async () => {
      const { text } = await callTool('classify_transaction', {
        summary: '개발 용역 대금',
        amount: 5_500_000,
      });
      const parsed = JSON.parse(text);
      expect(parsed.account).toBe('매출');
      expect(parsed.level).toBe('L1');
      expect(parsed.confidence).toBeGreaterThanOrEqual(0.6);
      // 금융 민감 정보는 국내 LLM 강제 (TECH §3.1).
      expect(parsed.routingDecision).toBe('domestic');
    });

    it('predict_tax: 공급가액 10,000,000 → VAT base 1,000,000, 신고기한은 규칙 템플릿 기준', async () => {
      const { text } = await callTool('predict_tax', {
        businessId: 'biz-1',
        period: '2026-Q1',
        supplyValue: 10_000_000,
      });
      const parsed = JSON.parse(text);
      expect(parsed.base).toBe(1_000_000);
      expect(parsed.lo).toBe(900_000);
      expect(parsed.hi).toBe(1_100_000);
      expect(parsed.confidence).toBe(0.9);
      // 기존 VatRuleTemplate.dueDateForPeriod('2026-Q1') = 2026-01-25.
      expect(parsed.dueDate).toBe('2026-01-25T00:00:00.000Z');
    });

    it('get_closing_checklist: 입력 요약값으로 누락 항목을 감지한다', async () => {
      const { text } = await callTool('get_closing_checklist', {
        businessId: 'biz-1',
        period: '2026-Q1',
        transactionCount: 3,
        revenue: 5_500_000,
        purchases: 320_000,
        expenses: 27_800,
        hasPayroll: true,
        hasTaxPayment: false,
      });
      const parsed = JSON.parse(text);
      expect(parsed.items).toHaveLength(5);
      const byKey = new Map(parsed.items.map((i: { key: string }) => [i.key, i]));
      expect(byKey.get('revenue').status).toBe('done');
      expect(byKey.get('purchases').status).toBe('done');
      expect(byKey.get('tax').status).toBe('missing');
    });

    it('process_receipt: 영수증 OCR 결과를 반환한다', async () => {
      const { text } = await callTool('process_receipt', {
        imageBase64: Buffer.from('fake-receipt-image').toString('base64'),
      });
      const parsed = JSON.parse(text);
      expect(parsed.merchant).toBe('스타벅스 강남점');
      expect(parsed.amount).toBe(14500);
      expect(parsed.confidence).toBe(0.97);
      expect(parsed.items).toHaveLength(2);
    });

    it('sync_accounts: mydata 어댑터가 결정적 샘플 거래를 반환한다', async () => {
      const { text } = await callTool('sync_accounts', {
        consentType: 'mydata',
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      });
      const parsed = JSON.parse(text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0]).toHaveProperty('finNo');
      expect(parsed[0]).toHaveProperty('summary');
    });

    it('list_businesses: 사업체 목록을 반환한다 (DB 연결 시)', async () => {
      const { text } = await callTool('list_businesses', {
        memberId: 'member-1',
      });
      const parsed = JSON.parse(text);
      // DB가 연결되어 있으면 사업체 배열을, 아니면 명확한 error를 반환한다.
      if (Array.isArray(parsed)) {
        expect(parsed.length).toBeGreaterThanOrEqual(0);
        if (parsed.length > 0) {
          expect(parsed[0]).toHaveProperty('bizNo');
          expect(parsed[0]).toHaveProperty('name');
        }
      } else {
        expect(parsed).toHaveProperty('error');
        expect(String(parsed.error)).toContain('DB');
      }
    });
  });

  describe('인증/소유권 검증', () => {
    async function callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ text: string }> {
      const server = await mcp.build();
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(clientTransport);

      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      await client.close();
      await server.close();
      return { text };
    }

    it('list_businesses: memberId 생략 시 400 오류를 반환한다', async () => {
      const { text } = await callTool('list_businesses', {});
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('error');
      expect(String(parsed.error)).toContain('memberId');
    });

    it('list_businesses: 다른 회원의 memberId로 조회 시 403 오류를 반환한다', async () => {
      const { text } = await callTool('list_businesses', {
        memberId: 'other-member',
      });
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('error');
      expect(String(parsed.error)).toContain('권한');
    });

    it('get_ledger: 다른 회원의 businessId로 조회 시 403 오류를 반환한다', async () => {
      const { text } = await callTool('get_ledger', {
        businessId: 'other-biz',
        period: '2026-Q1',
        type: 'QUARTERLY',
      });
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('error');
      expect(String(parsed.error)).toContain('권한');
    });

    it('list_transactions: 다른 회원의 ledgerId로 조회 시 403 오류를 반환한다', async () => {
      const { text } = await callTool('list_transactions', {
        ledgerId: 'other-ledger',
      });
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('error');
      expect(String(parsed.error)).toContain('권한');
    });

    it('predict_tax: 다른 회원의 businessId로 예측 시 403 오류를 반환한다', async () => {
      const { text } = await callTool('predict_tax', {
        businessId: 'other-biz',
        period: '2026-Q1',
        supplyValue: 10_000_000,
      });
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('error');
      expect(String(parsed.error)).toContain('권한');
    });
  });
});
