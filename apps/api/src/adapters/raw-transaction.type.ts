/**
 * RawTransaction — a normalized transaction as returned by any external
 * adapter (마이데이터 / 은행계열 API / 오픈뱅킹 / 홈택스 / PG).
 *
 * This is the canonical shape the domain layer consumes regardless of the
 * upstream provider. `amount` is signed (+ income, - expense).
 */
export interface RawTransaction {
  /** 금융거래 고유번호 (암호화 대상) */
  finNo: string;
  /** 거래·적요 (AES-256-GCM 암호화 대상) */
  summary: string;
  /** +/- 부호로 수입/지출 구분 */
  amount: number;
  /** 거래 발생 시각 */
  occurredAt: Date;
  /** 출처 제공자 (mydata / bank_api / openbanking / hometax / pg) */
  provider: string;
  /** 은행/카드 계좌 */
  account: string;
}
