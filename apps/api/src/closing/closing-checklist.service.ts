/**
 * ChecklistItem — a single closing-checklist item (PLAN §4.3).
 */
export interface ChecklistItem {
  key: string;
  label: string;
  status: 'pending' | 'done' | 'missing';
  required: boolean;
}

/**
 * LedgerSummary — minimal ledger data used to detect missing items.
 */
export interface LedgerSummary {
  /** 거래 건수 */
  transactionCount: number;
  /** 매출 합계 (양수) */
  revenue: number;
  /** 매입 합계 (음수 절대값) */
  purchases: number;
  /** 비용 합계 */
  expenses: number;
  /** 급여 지급 여부 */
  hasPayroll: boolean;
  /** 세금 납부 여부 */
  hasTaxPayment: boolean;
}

/**
 * ClosingChecklistService — generates a monthly/quarterly closing checklist
 * for a business and detects missing items based on ledger data (PLAN §4.3).
 */
export class ClosingChecklistService {
  /**
   * Generate the standard closing checklist. All items start as 'pending'.
   */
  generateChecklist(): ChecklistItem[] {
    return [
      { key: 'revenue', label: '매출 확인', status: 'pending', required: true },
      { key: 'purchases', label: '매입 확인', status: 'pending', required: true },
      { key: 'expenses', label: '비용 확인', status: 'pending', required: true },
      { key: 'payroll', label: '급여 확인', status: 'pending', required: true },
      { key: 'tax', label: '세금 확인', status: 'pending', required: true },
    ];
  }

  /**
   * Detect missing items based on ledger data. Items with no corresponding
   * activity are marked 'missing'; items with activity are marked 'done'.
   */
  detectMissingItems(ledger: LedgerSummary): ChecklistItem[] {
    const items = this.generateChecklist();
    const byKey = new Map(items.map((i) => [i.key, i]));

    byKey.get('revenue')!.status =
      ledger.transactionCount > 0 && ledger.revenue > 0 ? 'done' : 'missing';
    byKey.get('purchases')!.status =
      ledger.purchases > 0 ? 'done' : 'missing';
    byKey.get('expenses')!.status = ledger.expenses > 0 ? 'done' : 'missing';
    byKey.get('payroll')!.status = ledger.hasPayroll ? 'done' : 'missing';
    byKey.get('tax')!.status = ledger.hasTaxPayment ? 'done' : 'missing';

    return items;
  }
}
