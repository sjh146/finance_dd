import { Injectable } from '@nestjs/common';
import { BankApiAdapter, Consent, MyDataAdapter } from './adapter.interface';
import { RawTransaction } from './raw-transaction.type';

/**
 * Deterministic sample transactions shared by the mock adapters so tests can
 * assert on stable values. Amounts are signed (+ income, - expense).
 */
export const SAMPLE_TRANSACTIONS: RawTransaction[] = [
  {
    finNo: 'FIN-0001',
    summary: '개발 용역 대금',
    amount: 5_500_000,
    occurredAt: new Date('2026-01-05T09:00:00Z'),
    provider: 'mydata',
    account: '110-123-456789',
  },
  {
    finNo: 'FIN-0002',
    summary: 'AWS 클라우드 이용료',
    amount: -320_000,
    occurredAt: new Date('2026-01-08T03:00:00Z'),
    provider: 'mydata',
    account: '110-123-456789',
  },
  {
    finNo: 'FIN-0003',
    summary: '점심 식비',
    amount: -18_000,
    occurredAt: new Date('2026-01-10T05:30:00Z'),
    provider: 'mydata',
    account: '110-123-456789',
  },
  {
    finNo: 'FIN-0004',
    summary: '고속도로 통행료',
    amount: -9_800,
    occurredAt: new Date('2026-01-12T02:00:00Z'),
    provider: 'mydata',
    account: '110-123-456789',
  },
];

/**
 * MockMyDataAdapter — deterministic 마이데이터 adapter.
 * Returns a fixed sample set filtered by the requested date range.
 */
@Injectable()
export class MockMyDataAdapter implements MyDataAdapter {
  async fetchTransactions(
    _consent: Consent,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]> {
    return SAMPLE_TRANSACTIONS.filter(
      (t) => t.occurredAt >= from && t.occurredAt <= to,
    );
  }
}

/**
 * MockBankApiAdapter — deterministic 은행계열 API adapter.
 * Returns a fixed sample set filtered by the requested date range.
 */
@Injectable()
export class MockBankApiAdapter implements BankApiAdapter {
  async fetchTransactions(
    _account: string,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]> {
    return SAMPLE_TRANSACTIONS.filter(
      (t) => t.occurredAt >= from && t.occurredAt <= to,
    );
  }
}
