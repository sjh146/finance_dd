import { Module } from '@nestjs/common';
import { MockBankApiAdapter, MockMyDataAdapter } from './mock-adapters';
import { TransactionAdapterFactory } from './transaction-adapter.factory';

/**
 * AdaptersModule — external transaction adapters (마이데이터 / 은행계열 API).
 * Exposes the mock adapters and the factory that selects by consent type.
 * The factory chooses real vs mock MyData adapter via MYDATA_MODE.
 */
@Module({
  providers: [
    MockMyDataAdapter,
    MockBankApiAdapter,
    TransactionAdapterFactory,
  ],
  exports: [MockMyDataAdapter, MockBankApiAdapter, TransactionAdapterFactory],
})
export class AdaptersModule {}
