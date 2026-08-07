import { Injectable } from '@nestjs/common';
import {
  BankApiAdapter,
  Consent,
  MyDataAdapter,
} from './adapter.interface';
import { MockBankApiAdapter, MockMyDataAdapter } from './mock-adapters';

/**
 * TransactionAdapterFactory — selects the transaction adapter by consent type
 * (TECH §3). MVP 1차 경로: 마이데이터 + 은행계열 API 제휴.
 *
 * - 'mydata' → MyDataAdapter
 * - 'openbanking' / 'hometax' → BankApiAdapter (별도 트랙 stub; MVP에서는
 *   은행계열 API로 대체 처리)
 */
@Injectable()
export class TransactionAdapterFactory {
  constructor(
    private readonly myDataAdapter: MockMyDataAdapter,
    private readonly bankApiAdapter: MockBankApiAdapter,
  ) {}

  getMyDataAdapter(): MyDataAdapter {
    return this.myDataAdapter;
  }

  getBankApiAdapter(): BankApiAdapter {
    return this.bankApiAdapter;
  }

  /**
   * Resolve the adapter for a given consent. Throws for unknown consent types.
   */
  getAdapterForConsent(consent: Consent): MyDataAdapter | BankApiAdapter {
    switch (consent.type) {
      case 'mydata':
        return this.myDataAdapter;
      case 'openbanking':
      case 'hometax':
        // 별도 트랙 stub — MVP에서는 은행계열 API adapter로 대체.
        return this.bankApiAdapter;
      default:
        throw new Error(`Unsupported consent type: ${consent.type}`);
    }
  }
}
