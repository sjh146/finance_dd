import { RawTransaction } from './raw-transaction.type';

/**
 * Consent — minimal shape describing an active data-sharing consent.
 * In production this maps to the Consent entity; MVP keeps it minimal.
 */
export interface Consent {
  id: string;
  /** 'mydata' | 'openbanking' | 'hometax' */
  type: string;
  scope: string;
  status: string;
}

/**
 * MyDataAdapter — 마이데이터 경유 거래 조회 (TECH §3).
 * MVP 1차 경로: 마이데이터 채널 강조.
 */
export interface MyDataAdapter {
  fetchTransactions(
    consent: Consent,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]>;
}

/**
 * BankApiAdapter — 은행계열 API 제휴 거래 조회 (TECH §3).
 * MVP 1차 경로: 은행계열 API 제휴.
 */
export interface BankApiAdapter {
  fetchTransactions(
    account: string,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]>;
}

/**
 * OpenBankingAdapter — 직접 오픈뱅킹 등록 트랙 (TECH §3).
 * 별도 트랙, MVP 후순위 — stub only.
 */
export interface OpenBankingAdapter {
  fetchTransactions(
    consent: Consent,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]>;
}

/**
 * HometaxAdapter — 홈택스 조회용 (TECH §3).
 * 신고서 초안/홈택스는 후순위 — stub only.
 */
export interface HometaxAdapter {
  fetchTransactions(
    bizNo: string,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]>;
}

/**
 * PGExtractor — 카드사/PG 정산 대조 (TECH §3).
 * MVP 후순위 — stub only.
 */
export interface PGExtractor {
  extractSettlements(
    pgProvider: string,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]>;
}
