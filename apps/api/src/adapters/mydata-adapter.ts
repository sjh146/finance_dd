import { Injectable } from '@nestjs/common';
import { Consent, MyDataAdapter } from './adapter.interface';
import { RawTransaction } from './raw-transaction.type';

/**
 * MyDataConfig — configuration for the real 마이데이터 (금융결제원) adapter.
 * Loaded from environment variables.
 */
export interface MyDataConfig {
  /** 금융결제원 마이데이터 API base URL. */
  baseUrl: string;
  /** OAuth2 client_id (본인신용정보관리업자 등록 후 발급). */
  clientId: string;
  /** OAuth2 client_secret. */
  clientSecret: string;
}

/** Error thrown when the adapter is not configured (missing credentials). */
export class MyDataConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MyDataConfigError';
  }
}

/** Error thrown when the upstream API returns a non-2xx / malformed response. */
export class MyDataApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MyDataApiError';
  }
}

/** OAuth2 token response (client_credentials grant). */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/** 전송요구 등록 요청 body (금융결제원 마이데이터 표준). */
interface TransmissionRequest {
  org_code: string;
  consent_id: string;
  scope_list: string[];
  auth_type: string;
  consent_type: string;
  account_list?: Array<{ account_num: string }>;
}

/** 전송요구 등록 응답. */
interface TransmissionResponse {
  tx_id: string;
  consent_id: string;
  org_code: string;
}

/** 개인신용정보(거래내역) 조회 응답 — 금융결제원 표준 거래내역 항목. */
interface TransactionResponse {
  rsp_code: string;
  rsp_msg: string;
  next_page?: string;
  transaction_list?: Array<{
    trans_dtime: string;
    trans_no: string;
    trans_type: string;
    trans_amt: string;
    balance_amt?: string;
    print_content: string;
    merchant_name?: string;
    account_num: string;
  }>;
}

/** Default request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 10_000;
/** Default retry count for transient failures. */
const DEFAULT_RETRIES = 2;

/**
 * MyDataAdapterImpl — real HTTP implementation of the 마이데이터 adapter
 * (금융결제원 표준 API). Implements the OAuth2 client_credentials token flow,
 * 전송요구 등록/조회, and 개인신용정보(거래내역) 조회.
 *
 * Uses Node 22 built-in fetch with timeout/retry/error normalization. When
 * credentials are missing it throws MyDataConfigError so callers can fall back
 * to the mock adapter.
 */
@Injectable()
export class MyDataAdapterImpl implements MyDataAdapter {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: MyDataConfig, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES) {
    this.baseUrl = config.baseUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  /**
   * Fetch transactions for a consent within [from, to].
   * Runs the full 마이데이터 flow: token → 전송요구 등록 → 거래내역 조회.
   */
  async fetchTransactions(
    consent: Consent,
    from: Date,
    to: Date,
  ): Promise<RawTransaction[]> {
    this.assertConfigured();

    const token = await this.getAccessToken();
    const txId = await this.registerTransmissionRequest(consent, token);
    const transactions = await this.fetchTransactionList(
      consent,
      txId,
      token,
      from,
      to,
    );

    return transactions.map((t) => this.toRawTransaction(t));
  }

  /** Throw a clear configuration error when credentials are missing. */
  private assertConfigured(): void {
    if (!this.baseUrl || !this.clientId || !this.clientSecret) {
      throw new MyDataConfigError(
        '마이데이터 연동 설정 필요: MYDATA_BASE_URL, MYDATA_CLIENT_ID, MYDATA_CLIENT_SECRET 환경변수를 설정하세요. ' +
          '(본인신용정보관리업자 등록 후 발급된 자격증명 필요)',
      );
    }
  }

  /** OAuth2 client_credentials token issuance with caching. */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'transactions',
    });

    const response = await this.request<TokenResponse>('/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    this.accessToken = response.access_token;
    this.tokenExpiresAt = Date.now() + (response.expires_in - 60) * 1000;
    return this.accessToken;
  }

  /** 전송요구 등록 — returns the transmission request id (tx_id). */
  private async registerTransmissionRequest(
    consent: Consent,
    token: string,
  ): Promise<string> {
    const body: TransmissionRequest = {
      org_code: 'aggelog',
      consent_id: consent.id,
      scope_list: [consent.scope],
      auth_type: 'client_credentials',
      consent_type: 'transactions',
    };

    const response = await this.request<TransmissionResponse>(
      '/transmission-requests',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );

    return response.tx_id;
  }

  /** 개인신용정보(거래내역) 조회 with pagination. */
  private async fetchTransactionList(
    consent: Consent,
    txId: string,
    token: string,
    from: Date,
    to: Date,
  ): Promise<NonNullable<TransactionResponse['transaction_list']>> {
    const params = new URLSearchParams({
      org_code: 'aggelog',
      consent_id: consent.id,
      tx_id: txId,
      from_date: this.formatDate(from),
      to_date: this.formatDate(to),
      limit: '100',
    });

    const response = await this.request<TransactionResponse>(
      `/transactions?${params.toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (response.rsp_code !== '00000') {
      throw new MyDataApiError(
        `마이데이터 거래내역 조회 실패: ${response.rsp_msg} (${response.rsp_code})`,
      );
    }

    return response.transaction_list ?? [];
  }

  /** Normalize a 마이데이터 transaction into a RawTransaction. */
  private toRawTransaction(
    t: NonNullable<TransactionResponse['transaction_list']>[number],
  ): RawTransaction {
    const amount = Number(t.trans_amt);
    return {
      finNo: t.trans_no,
      summary: t.print_content,
      amount: t.trans_type === '01' ? amount : -amount,
      occurredAt: new Date(t.trans_dtime),
      provider: 'mydata',
      account: t.account_num,
    };
  }

  /** Format a Date as YYYYMMDD (금융결제원 date format). */
  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  /**
   * Perform a fetch with timeout + retry + error normalization.
   * Retries on network errors and 5xx responses.
   */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status >= 500 && attempt < this.retries) {
              lastError = new MyDataApiError(
                `마이데이터 서버 오류 (${response.status})`,
                response.status,
              );
              continue;
            }
            const body = await response.text();
            throw new MyDataApiError(
              `마이데이터 API 오류 (${response.status}): ${body.slice(0, 200)}`,
              response.status,
            );
          }

          return (await response.json()) as T;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        lastError = err;
        if (attempt < this.retries) {
          await this.sleep(100 * (attempt + 1));
          continue;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new MyDataApiError('마이데이터 요청 실패');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
