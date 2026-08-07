import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DataSensitivity } from '@prisma/client';
import { ClassificationPipelineService } from '@aggelog/api/classification/classification-pipeline.service';
import { ClosingChecklistService } from '@aggelog/api/closing/closing-checklist.service';
import { OcrService } from '@aggelog/api/ocr/ocr.service';
import { TaxPredictionService } from '@aggelog/api/prediction/tax-prediction.service';
import { VatRuleTemplate } from '@aggelog/api/prediction/vat-rule.template';
import { TransactionAdapterFactory } from '@aggelog/api/adapters/transaction-adapter.factory';
import { RegionalRoutingPolicy } from '@aggelog/api/llm/regional-routing.policy';
import { PrismaService } from '@aggelog/api/prisma/prisma.service';
import {
  ClassifyTransactionSchema,
  GetClosingChecklistSchema,
  GetLedgerSchema,
  ListBusinessesSchema,
  ListTransactionsSchema,
  PredictTaxSchema,
  ProcessReceiptSchema,
  SyncAccountsSchema,
} from './schemas';

/**
 * MCP 도구 핸들러 등록.
 *
 * 각 도구는 NestJS 도메인 서비스(분류·예측·체크리스트·OCR·어댑터·LLM)를
 * 직접 호출한다 (TECH_ARCHITECTURE.md §3 v2.1). DB 조회 실패 시 명확한
 * 오류 메시지를 MCP text content로 반환한다.
 */

/** DB 오류를 명확한 메시지로 감싸는 헬퍼. */
function dbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `DB 조회 실패: ${msg} (DATABASE_URL이 .env.example에서 주입되었는지, PostgreSQL이 실행 중인지 확인하세요)`;
}

/** MCP text content 헬퍼. */
function textContent(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * 모든 도구를 McpServer에 등록한다.
 */
export function registerTools(
  server: McpServer,
  deps: {
    prisma: PrismaService;
    classification: ClassificationPipelineService;
    closing: ClosingChecklistService;
    ocr: OcrService;
    prediction: TaxPredictionService;
    adapters: TransactionAdapterFactory;
    routing: RegionalRoutingPolicy;
  },
): void {
  const {
    prisma,
    classification,
    closing,
    ocr,
    prediction: predictionService,
    adapters,
    routing: routingPolicy,
  } = deps;

  // -------------------------------------------------------------------------
  // list_businesses — 사업체 목록 조회
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_businesses',
    {
      title: '사업체 목록 조회',
      description:
        '등록된 사업체(사업자) 목록을 조회합니다. memberId를 지정하면 해당 회원의 사업체만 반환합니다. 각 사업체의 ID, 사업자등록번호, 상호, 업종, 유형(개인/법인), 규모를 포함합니다.',
      inputSchema: ListBusinessesSchema,
    },
    async (args) => {
      try {
        const businesses = await prisma.business.findMany({
          where: args.memberId ? { memberId: args.memberId } : undefined,
          orderBy: { createdAt: 'asc' },
        });
        return textContent(JSON.stringify(businesses, null, 2));
      } catch (e) {
        return textContent(JSON.stringify({ error: dbError(e) }));
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_ledger — 장부 조회
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_ledger',
    {
      title: '장부 조회',
      description:
        '사업체의 특정 기간 장부를 조회합니다. businessId, period(예: 2026-Q1), type(MONTHLY/QUARTERLY)을 입력받아 장부 정보와 연결된 거래 목록을 반환합니다.',
      inputSchema: GetLedgerSchema,
    },
    async (args) => {
      try {
        const ledger = await prisma.ledger.findUnique({
          where: {
            businessId_period_type: {
              businessId: args.businessId,
              period: args.period,
              type: args.type,
            },
          },
          include: { transactions: true },
        });
        if (!ledger) {
          return textContent(
            JSON.stringify({
              error: `장부를 찾을 수 없습니다: businessId=${args.businessId}, period=${args.period}, type=${args.type}`,
            }),
          );
        }
        return textContent(JSON.stringify(ledger, null, 2));
      } catch (e) {
        return textContent(JSON.stringify({ error: dbError(e) }));
      }
    },
  );

  // -------------------------------------------------------------------------
  // list_transactions — 거래 목록 조회
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_transactions',
    {
      title: '거래 목록 조회',
      description:
        '특정 장부(ledgerId)의 거래 목록을 조회합니다. from/to(ISO 8601)로 기간을 좁힐 수 있습니다. 각 거래의 금액(+/-), 발생시각, 적요, 출처 제공자, 계좌를 포함합니다.',
      inputSchema: ListTransactionsSchema,
    },
    async (args) => {
      try {
        const transactions = await prisma.transaction.findMany({
          where: {
            ledgerId: args.ledgerId,
            ...(args.from || args.to
              ? {
                  occurredAt: {
                    ...(args.from ? { gte: new Date(args.from) } : {}),
                    ...(args.to ? { lte: new Date(args.to) } : {}),
                  },
                }
              : {}),
          },
          orderBy: { occurredAt: 'asc' },
        });
        return textContent(JSON.stringify(transactions, null, 2));
      } catch (e) {
        return textContent(JSON.stringify({ error: dbError(e) }));
      }
    },
  );

  // -------------------------------------------------------------------------
  // classify_transaction — 거래 분류 (L1 규칙 → L2 → L3, LLM 지역 라우팅)
  // -------------------------------------------------------------------------
  server.registerTool(
    'classify_transaction',
    {
      title: '거래 분류',
      description:
        '거래를 계정과목으로 분류합니다. 3단계 계단식 파이프라인(L1 규칙 → L2 임베딩 → L3 LLM)을 사용하며, 계정과목·확신도·분류 단계·근거를 반환합니다. 금융 민감 정보는 국내 LLM으로 강제 라우팅됩니다(지역 라우팅 정책).',
      inputSchema: ClassifyTransactionSchema,
    },
    async (args) => {
      // 금융 거래 적요는 FINANCIAL_SENSITIVE → 국내 강제 (TECH §3.1).
      const routing = routingPolicy.route(DataSensitivity.FINANCIAL_SENSITIVE);
      const result = await classification.classify({
        summary: args.summary,
        merchant: args.merchant,
        amount: args.amount,
      });
      return textContent(
        JSON.stringify({ ...result, routingDecision: routing }, null, 2),
      );
    },
  );

  // -------------------------------------------------------------------------
  // predict_tax — 세금 예측 (VAT 규칙 템플릿 + DB 영속화)
  // -------------------------------------------------------------------------
  server.registerTool(
    'predict_tax',
    {
      title: '세금 예측',
      description:
        '부가가치세(VAT) 예측을 수행합니다. 공급가액을 입력받아 신뢰 구간(lo~hi), 기준 금액, 신고기한을 반환하고 결과를 DB에 저장합니다. 기간은 분기 형식(예: 2026-Q1)이어야 합니다.',
      inputSchema: PredictTaxSchema,
    },
    async (args) => {
      // 예측 계산은 DB 의존 없이 규칙 템플릿으로 수행한다 (TECH §4.2).
      const prediction = new VatRuleTemplate().predict(
        {
          supplyValue: args.supplyValue,
          purchaseValue: args.purchaseValue,
        },
        args.period,
      );

      // 영속화는 DB가 필요하므로 실패해도 예측 결과는 반환한다.
      let persisted = false;
      let persistError: string | undefined;
      try {
        await predictionService.predictVat(args.businessId, args.period, {
          supplyValue: args.supplyValue,
          purchaseValue: args.purchaseValue,
        });
        persisted = true;
      } catch (e) {
        persistError = e instanceof Error ? e.message : String(e);
      }

      return textContent(
        JSON.stringify(
          {
            ...prediction,
            dueDate: prediction.dueDate.toISOString(),
            persisted,
            ...(persistError ? { persistError } : {}),
          },
          null,
          2,
        ),
      );
    },
  );

  // -------------------------------------------------------------------------
  // get_closing_checklist — 마감 체크리스트 조회
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_closing_checklist',
    {
      title: '마감 체크리스트 조회',
      description:
        '사업체의 월/분기 마감 체크리스트를 생성합니다. DB에서 장부 거래를 집계해 누락 항목(매출·매입·비용·급여·세금)을 감지합니다. DB 조회가 불가하면 입력으로 제공된 요약값을 사용합니다.',
      inputSchema: GetClosingChecklistSchema,
    },
    async (args) => {
      const type = args.type ?? 'QUARTERLY';
      let summary = {
        transactionCount: args.transactionCount ?? 0,
        revenue: args.revenue ?? 0,
        purchases: args.purchases ?? 0,
        expenses: args.expenses ?? 0,
        hasPayroll: args.hasPayroll ?? false,
        hasTaxPayment: args.hasTaxPayment ?? false,
      };

      // DB에서 장부 거래를 집계 (가능한 경우).
      try {
        const ledger = await prisma.ledger.findUnique({
          where: {
            businessId_period_type: {
              businessId: args.businessId,
              period: args.period,
              type,
            },
          },
          include: { transactions: true },
        });
        if (ledger && ledger.transactions.length > 0) {
          const txns = ledger.transactions;
          const revenue = txns
            .filter((t) => t.amount.gt(0))
            .reduce((s, t) => s + Number(t.amount), 0);
          const purchases = txns
            .filter((t) => t.amount.lt(0))
            .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
          summary = {
            transactionCount: txns.length,
            revenue,
            purchases,
            expenses: purchases,
            hasPayroll: txns.some((t) =>
              /급여|월급|임금/.test(t.summary),
            ),
            hasTaxPayment: txns.some((t) =>
              /세금|부가세|소득세/.test(t.summary),
            ),
          };
        }
      } catch {
        // DB 조회 실패 시 입력 요약값 사용 (이미 위에서 초기화됨).
      }

      const items = closing.detectMissingItems(summary);
      return textContent(
        JSON.stringify({ businessId: args.businessId, period: args.period, items }, null, 2),
      );
    },
  );

  // -------------------------------------------------------------------------
  // process_receipt — 영수증 처리 (OCR)
  // -------------------------------------------------------------------------
  server.registerTool(
    'process_receipt',
    {
      title: '영수증 처리 (OCR)',
      description:
        '영수증 이미지(Base64)를 OCR로 처리해 총 금액, 가맹점, 거래 일시, 품목 라인, 원본 텍스트, 신뢰도를 추출합니다. 금융 민감 정보는 국내 처리 원칙을 따릅니다.',
      inputSchema: ProcessReceiptSchema,
    },
    async (args) => {
      try {
        const buffer = Buffer.from(args.imageBase64, 'base64');
        const result = await ocr.extractReceipt(buffer);
        return textContent(
          JSON.stringify(
            { ...result, date: result.date.toISOString() },
            null,
            2,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return textContent(
          JSON.stringify({ error: `영수증 처리 실패: ${msg}` }),
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // sync_accounts — 계좌 동기화 (마이데이터/은행계열 API 어댑터)
  // -------------------------------------------------------------------------
  server.registerTool(
    'sync_accounts',
    {
      title: '계좌 동기화',
      description:
        '외부 금융 어댑터(마이데이터/은행계열 API)에서 거래를 동기화합니다. consentType(mydata/openbanking/hometax)과 기간을 입력받아 원시 거래 목록을 반환합니다. MVP에서는 목(mock) 어댑터가 결정적 샘플 데이터를 반환합니다.',
      inputSchema: SyncAccountsSchema,
    },
    async (args) => {
      try {
        const from = new Date(args.from);
        const to = new Date(args.to);
        const consent = {
          id: 'mcp-sync',
          type: args.consentType,
          scope: 'banking:read card:read',
          status: 'ACTIVE',
        };
        // mydata → MyDataAdapter(Consent), 그 외 → BankApiAdapter(계좌).
        const transactions =
          args.consentType === 'mydata'
            ? await adapters
                .getMyDataAdapter()
                .fetchTransactions(consent, from, to)
            : await adapters
                .getBankApiAdapter()
                .fetchTransactions(args.account ?? '', from, to);
        return textContent(
          JSON.stringify(
            transactions.map((t) => ({
              ...t,
              occurredAt: t.occurredAt.toISOString(),
            })),
            null,
            2,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return textContent(JSON.stringify({ error: `동기화 실패: ${msg}` }));
      }
    },
  );
}
