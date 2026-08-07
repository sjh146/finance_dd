import { VatRuleTemplate } from './vat-rule.template';

describe('VatRuleTemplate', () => {
  it('computes base = supplyValue * 0.1', () => {
    const prediction = new VatRuleTemplate().predict(
      { supplyValue: 10_000_000 },
      '2026-Q1',
    );
    expect(prediction.base).toBe(1_000_000);
  });

  it('computes confidence interval lo = base*0.9, hi = base*1.1', () => {
    const prediction = new VatRuleTemplate().predict(
      { supplyValue: 10_000_000 },
      '2026-Q1',
    );
    expect(prediction.lo).toBe(900_000);
    expect(prediction.hi).toBe(1_100_000);
    expect(prediction.confidence).toBe(0.9);
  });

  it('computes due date for each quarter (1/25, 4/25, 7/25, 10/25)', () => {
    const template = new VatRuleTemplate();
    expect(template.predict({ supplyValue: 100 }, '2026-Q1').dueDate).toEqual(
      new Date(Date.UTC(2026, 0, 25)),
    );
    expect(template.predict({ supplyValue: 100 }, '2026-Q2').dueDate).toEqual(
      new Date(Date.UTC(2026, 3, 25)),
    );
    expect(template.predict({ supplyValue: 100 }, '2026-Q3').dueDate).toEqual(
      new Date(Date.UTC(2026, 6, 25)),
    );
    expect(template.predict({ supplyValue: 100 }, '2026-Q4').dueDate).toEqual(
      new Date(Date.UTC(2026, 9, 25)),
    );
  });

  it('throws for invalid period format', () => {
    expect(() => VatRuleTemplate.dueDateForPeriod('2026-01')).toThrow(
      'Invalid quarter period',
    );
  });

  it('exposes the versioned template id', () => {
    expect(VatRuleTemplate.VERSION).toBe('template:vat-10pct-v1');
  });
});
