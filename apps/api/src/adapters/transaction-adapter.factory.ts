import { Injectable } from '@nestjs/common';
import {
  BankApiAdapter,
  Consent,
  MyDataAdapter,
} from './adapter.interface';
import { MockBankApiAdapter, MockMyDataAdapter } from './mock-adapters';
import {
  MyDataAdapterImpl,
  MyDataConfig,
  MyDataConfigError,
} from './mydata-adapter';

/**
 * TransactionAdapterFactory — selects the transaction adapter by consent type
 * (TECH §3). MVP 1차 경로: 마이데이터 + 은행계열 API 제휴.
 *
 * - 'mydata' → MyDataAdapter (real HTTP when MYDATA_MODE=real, else mock)
 * - 'openbanking' / 'hometax' → BankApiAdapter (별도 트랙 stub; MVP에서는
 *   은행계열 API로 대체 처리)
 *
 * MYDATA_MODE env:
 *   - 'real' → use MyDataAdapterImpl (requires MYDATA_BASE_URL/CLIENT_ID/SECRET)
 *   - 'mock' (default) → use MockMyDataAdapter
 */
@Injectable()
export class TransactionAdapterFactory {
  private readonly myDataAdapter: MyDataAdapter;

  constructor(
    private readonly mockMyDataAdapter: MockMyDataAdapter,
    private readonly bankApiAdapter: MockBankApiAdapter,
  ) {
    this.myDataAdapter = this.buildMyDataAdapter();
  }

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

  /** Build the MyData adapter based on MYDATA_MODE. */
  private buildMyDataAdapter(): MyDataAdapter {
    const mode = process.env.MYDATA_MODE ?? 'mock';
    if (mode === 'real') {
      const config: MyDataConfig = {
        baseUrl: process.env.MYDATA_BASE_URL ?? '',
        clientId: process.env.MYDATA_CLIENT_ID ?? '',
        clientSecret: process.env.MYDATA_CLIENT_SECRET ?? '',
      };
      if (!config.baseUrl || !config.clientId || !config.clientSecret) {
        throw new MyDataConfigError(
          'MYDATA_MODE=real 이지만 자격증명이 설정되지 않았습니다. ' +
            'MYDATA_BASE_URL, MYDATA_CLIENT_ID, MYDATA_CLIENT_SECRET 환경변수를 설정하거나 ' +
            'MYDATA_MODE=mock 으로 폴백하세요.',
        );
      }
      return new MyDataAdapterImpl(config);
    }
    return this.mockMyDataAdapter;
  }
}
