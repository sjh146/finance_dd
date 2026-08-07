import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Consent } from './adapter.interface';
import {
  MyDataAdapterImpl,
  MyDataConfigError,
  MyDataApiError,
} from './mydata-adapter';

/**
 * Local stub server that mimics the 금융결제원 마이데이터 API:
 *   POST /oauth2/token            → OAuth2 client_credentials token
 *   POST /transmission-requests   → 전송요구 등록 (tx_id)
 *   GET  /transactions            → 개인신용정보(거래내역) 조회
 */
function createStubServer(): {
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
} {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/oauth2/token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'stub-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'transactions',
        }),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/transmission-requests') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tx_id: 'tx-12345',
          consent_id: 'c1',
          org_code: 'aggelog',
        }),
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/transactions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          rsp_code: '00000',
          rsp_msg: '정상',
          transaction_list: [
            {
              trans_dtime: '2026-01-05T09:00:00+09:00',
              trans_no: 'FIN-1001',
              trans_type: '01',
              trans_amt: '5500000',
              print_content: '개발 용역 대금',
              merchant_name: '고객사',
              account_num: '110-123-456789',
            },
            {
              trans_dtime: '2026-01-08T03:00:00+09:00',
              trans_no: 'FIN-1002',
              trans_type: '02',
              trans_amt: '320000',
              print_content: 'AWS 클라우드 이용료',
              merchant_name: 'Amazon',
              account_num: '110-123-456789',
            },
          ],
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rsp_code: '40400', rsp_msg: 'Not Found' }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

describe('MyDataAdapterImpl', () => {
  let stub: { server: Server; baseUrl: string; close: () => Promise<void> };
  let consent: Consent;

  beforeAll(async () => {
    stub = await createStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    consent = {
      id: 'c1',
      type: 'mydata',
      scope: 'transactions',
      status: 'ACTIVE',
    };
  });

  it('fetches transactions through the full 마이데이터 flow', async () => {
    const adapter = new MyDataAdapterImpl({
      baseUrl: stub.baseUrl,
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-31T23:59:59Z');
    const result = await adapter.fetchTransactions(consent, from, to);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      finNo: 'FIN-1001',
      summary: '개발 용역 대금',
      amount: 5_500_000,
      provider: 'mydata',
      account: '110-123-456789',
    });
    expect(result[1].amount).toBe(-320_000);
  });

  it('throws MyDataConfigError when credentials are missing', async () => {
    const adapter = new MyDataAdapterImpl({
      baseUrl: '',
      clientId: '',
      clientSecret: '',
    });

    await expect(
      adapter.fetchTransactions(consent, new Date(), new Date()),
    ).rejects.toBeInstanceOf(MyDataConfigError);
  });

  it('throws MyDataApiError on upstream 5xx after retries', async () => {
    const failingServer = createServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rsp_code: '50000', rsp_msg: 'Server Error' }));
    });
    await new Promise<void>((resolve) =>
      failingServer.listen(0, '127.0.0.1', resolve),
    );
    const { port } = failingServer.address() as AddressInfo;

    const adapter = new MyDataAdapterImpl(
      {
        baseUrl: `http://127.0.0.1:${port}`,
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      1000,
      1,
    );

    await expect(
      adapter.fetchTransactions(consent, new Date(), new Date()),
    ).rejects.toBeInstanceOf(MyDataApiError);

    await new Promise<void>((resolve) => failingServer.close(() => resolve()));
  });
});
