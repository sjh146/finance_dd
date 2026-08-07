import { Test, TestingModule } from '@nestjs/testing';
import {
  MockBankApiAdapter,
  MockMyDataAdapter,
  SAMPLE_TRANSACTIONS,
} from './mock-adapters';
import { TransactionAdapterFactory } from './transaction-adapter.factory';
import { Consent } from './adapter.interface';

describe('MockMyDataAdapter', () => {
  let adapter: MockMyDataAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockMyDataAdapter],
    }).compile();
    adapter = module.get(MockMyDataAdapter);
  });

  it('returns deterministic sample transactions', async () => {
    const consent: Consent = {
      id: 'c1',
      type: 'mydata',
      scope: 'transactions',
      status: 'ACTIVE',
    };
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-31T23:59:59Z');
    const result = await adapter.fetchTransactions(consent, from, to);
    expect(result).toEqual(SAMPLE_TRANSACTIONS);
  });

  it('filters transactions outside the requested date range', async () => {
    const consent: Consent = {
      id: 'c1',
      type: 'mydata',
      scope: 'transactions',
      status: 'ACTIVE',
    };
    const from = new Date('2026-01-09T00:00:00Z');
    const to = new Date('2026-01-31T23:59:59Z');
    const result = await adapter.fetchTransactions(consent, from, to);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.occurredAt >= from && t.occurredAt <= to)).toBe(
      true,
    );
  });
});

describe('MockBankApiAdapter', () => {
  let adapter: MockBankApiAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockBankApiAdapter],
    }).compile();
    adapter = module.get(MockBankApiAdapter);
  });

  it('returns deterministic sample transactions for an account', async () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-31T23:59:59Z');
    const result = await adapter.fetchTransactions('110-123-456789', from, to);
    expect(result).toEqual(SAMPLE_TRANSACTIONS);
  });
});

describe('TransactionAdapterFactory', () => {
  let factory: TransactionAdapterFactory;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MockMyDataAdapter, MockBankApiAdapter, TransactionAdapterFactory],
    }).compile();
    factory = module.get(TransactionAdapterFactory);
  });

  it('selects MyDataAdapter for mydata consent', () => {
    const consent: Consent = {
      id: 'c1',
      type: 'mydata',
      scope: 'transactions',
      status: 'ACTIVE',
    };
    const adapter = factory.getAdapterForConsent(consent);
    expect(adapter).toBeInstanceOf(MockMyDataAdapter);
  });

  it('selects BankApiAdapter for openbanking consent (stub track)', () => {
    const consent: Consent = {
      id: 'c2',
      type: 'openbanking',
      scope: 'transactions',
      status: 'ACTIVE',
    };
    const adapter = factory.getAdapterForConsent(consent);
    expect(adapter).toBeInstanceOf(MockBankApiAdapter);
  });

  it('throws for unknown consent type', () => {
    const consent: Consent = {
      id: 'c3',
      type: 'unknown',
      scope: 'transactions',
      status: 'ACTIVE',
    };
    expect(() => factory.getAdapterForConsent(consent)).toThrow(
      'Unsupported consent type',
    );
  });
});
