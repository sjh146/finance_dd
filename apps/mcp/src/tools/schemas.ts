import { z } from 'zod';

/**
 * MCP 도구 입력 스키마 (Zod).
 *
 * 각 도구는 한국어 설명을 포함한 Zod 스키마로 입력을 정의한다.
 * MCP SDK가 이 스키마를 JSON Schema로 변환해 클라이언트(Hermes 등)에 노출한다.
 */

/** 사업체 목록 조회 */
export const ListBusinessesSchema = z.object({
  /** 회원 ID (선택). 지정 시 해당 회원의 사업체만 반환. */
  memberId: z.string().optional().describe('회원 ID (선택)'),
});

/** 장부 조회 */
export const GetLedgerSchema = z.object({
  /** 사업체 ID */
  businessId: z.string().describe('사업체 ID'),
  /** 장부 기간 (예: 2026-Q1, 2026-01) */
  period: z.string().describe('장부 기간 (예: 2026-Q1, 2026-01)'),
  /** 장부 유형: MONTHLY(년월) 또는 QUARTERLY(분기) */
  type: z
    .enum(['MONTHLY', 'QUARTERLY'])
    .describe('장부 유형: MONTHLY(년월) 또는 QUARTERLY(분기)'),
});

/** 거래 목록 조회 */
export const ListTransactionsSchema = z.object({
  /** 장부 ID */
  ledgerId: z.string().describe('장부 ID'),
  /** 조회 시작 시각 (ISO 8601, 선택) */
  from: z.string().optional().describe('조회 시작 시각 (ISO 8601, 선택)'),
  /** 조회 종료 시각 (ISO 8601, 선택) */
  to: z.string().optional().describe('조회 종료 시각 (ISO 8601, 선택)'),
});

/** 거래 분류 */
export const ClassifyTransactionSchema = z.object({
  /** 거래·적요 (예: "개발 용역 대금") */
  summary: z.string().describe('거래·적요 (예: "개발 용역 대금")'),
  /** 거래처/가맹점 (선택) */
  merchant: z.string().optional().describe('거래처/가맹점 (선택)'),
  /** +/- 부호 금액 (양수=수입, 음수=지출) */
  amount: z.number().describe('+/- 부호 금액 (양수=수입, 음수=지출)'),
});

/** 세금 예측 */
export const PredictTaxSchema = z.object({
  /** 사업체 ID */
  businessId: z.string().describe('사업체 ID'),
  /** 신고 대상 기간 (예: 2026-Q1) */
  period: z.string().describe('신고 대상 기간 (예: 2026-Q1)'),
  /** 공급가액 */
  supplyValue: z.number().describe('공급가액'),
  /** 매입 (선택) */
  purchaseValue: z.number().optional().describe('매입 (선택)'),
});

/** 마감 체크리스트 조회 */
export const GetClosingChecklistSchema = z.object({
  /** 사업체 ID */
  businessId: z.string().describe('사업체 ID'),
  /** 장부 기간 (예: 2026-Q1) */
  period: z.string().describe('장부 기간 (예: 2026-Q1)'),
  /** 장부 유형 (기본 QUARTERLY) */
  type: z
    .enum(['MONTHLY', 'QUARTERLY'])
    .optional()
    .describe('장부 유형 (기본 QUARTERLY)'),
  /** 거래 건수 (DB 조회 불가 시 수동 제공, 선택) */
  transactionCount: z.number().optional().describe('거래 건수 (선택)'),
  /** 매출 합계 (선택) */
  revenue: z.number().optional().describe('매출 합계 (선택)'),
  /** 매입 합계 (선택) */
  purchases: z.number().optional().describe('매입 합계 (선택)'),
  /** 비용 합계 (선택) */
  expenses: z.number().optional().describe('비용 합계 (선택)'),
  /** 급여 지급 여부 (선택) */
  hasPayroll: z.boolean().optional().describe('급여 지급 여부 (선택)'),
  /** 세금 납부 여부 (선택) */
  hasTaxPayment: z.boolean().optional().describe('세금 납부 여부 (선택)'),
});

/** 영수증 처리 (OCR) */
export const ProcessReceiptSchema = z.object({
  /** 영수증 이미지 (Base64 인코딩) */
  imageBase64: z.string().describe('영수증 이미지 (Base64 인코딩)'),
});

/** 계좌 동기화 */
export const SyncAccountsSchema = z.object({
  /** 동의 유형: mydata / openbanking / hometax */
  consentType: z
    .enum(['mydata', 'openbanking', 'hometax'])
    .describe('동의 유형: mydata / openbanking / hometax'),
  /** 계좌 번호 (은행계열 API 경로에서 사용, 선택) */
  account: z.string().optional().describe('계좌 번호 (선택)'),
  /** 조회 시작 시각 (ISO 8601) */
  from: z.string().describe('조회 시작 시각 (ISO 8601)'),
  /** 조회 종료 시각 (ISO 8601) */
  to: z.string().describe('조회 종료 시각 (ISO 8601)'),
});

/** 등록된 모든 도구의 이름 목록 (테스트/검증용) */
export const TOOL_NAMES = [
  'list_businesses',
  'get_ledger',
  'list_transactions',
  'classify_transaction',
  'predict_tax',
  'get_closing_checklist',
  'process_receipt',
  'sync_accounts',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
