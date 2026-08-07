import { ClosingChecklistService, LedgerSummary } from './closing-checklist.service';

describe('ClosingChecklistService', () => {
  let service: ClosingChecklistService;

  beforeEach(() => {
    service = new ClosingChecklistService();
  });

  it('generates the standard 5-item checklist, all pending', () => {
    const items = service.generateChecklist();
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.key)).toEqual([
      'revenue',
      'purchases',
      'expenses',
      'payroll',
      'tax',
    ]);
    expect(items.every((i) => i.status === 'pending')).toBe(true);
    expect(items.every((i) => i.required)).toBe(true);
  });

  it('marks all items done when ledger is complete', () => {
    const ledger: LedgerSummary = {
      transactionCount: 10,
      revenue: 5_000_000,
      purchases: 2_000_000,
      expenses: 1_000_000,
      hasPayroll: true,
      hasTaxPayment: true,
    };
    const items = service.detectMissingItems(ledger);
    expect(items.every((i) => i.status === 'done')).toBe(true);
  });

  it('marks 매출 as missing when there are no transactions', () => {
    const ledger: LedgerSummary = {
      transactionCount: 0,
      revenue: 0,
      purchases: 0,
      expenses: 0,
      hasPayroll: false,
      hasTaxPayment: false,
    };
    const items = service.detectMissingItems(ledger);
    const revenue = items.find((i) => i.key === 'revenue')!;
    expect(revenue.status).toBe('missing');
  });

  it('marks individual missing items based on ledger gaps', () => {
    const ledger: LedgerSummary = {
      transactionCount: 5,
      revenue: 3_000_000,
      purchases: 0,
      expenses: 500_000,
      hasPayroll: false,
      hasTaxPayment: true,
    };
    const items = service.detectMissingItems(ledger);
    expect(items.find((i) => i.key === 'revenue')!.status).toBe('done');
    expect(items.find((i) => i.key === 'purchases')!.status).toBe('missing');
    expect(items.find((i) => i.key === 'expenses')!.status).toBe('done');
    expect(items.find((i) => i.key === 'payroll')!.status).toBe('missing');
    expect(items.find((i) => i.key === 'tax')!.status).toBe('done');
  });
});
