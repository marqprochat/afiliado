import type { AliexpressCredentials } from '../adapter';
import { signAliexpressRequest } from './signature';

export const ALIEXPRESS_API_URL = 'https://api-sg.aliexpress.com/sync';

export class AliexpressApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string | number,
    public readonly subCode?: string,
  ) {
    super(message);
    this.name = 'AliexpressApiError';
  }
}

export interface AliexpressClientOptions {
  apiUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class AliexpressClient {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly creds: AliexpressCredentials,
    opts: AliexpressClientOptions = {},
  ) {
    this.apiUrl = opts.apiUrl ?? ALIEXPRESS_API_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async execute<T>(
    method: string,
    businessParams: Record<string, unknown> = {},
    retried = false,
  ): Promise<T> {
    const timestamp = Date.now();
    const params: Record<string, unknown> = {
      app_key: this.creds.appKey,
      timestamp,
      format: 'json',
      v: '2.0',
      sign_method: 'sha256',
      method,
      simplify: true,
      ...businessParams,
    };

    const sign = signAliexpressRequest(params, this.creds.appSecret);
    params.sign = sign;

    const queryParams = Object.entries(params)
      .filter(([_, value]) => value !== undefined && value !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');

    const url = `${this.apiUrl}?${queryParams}`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
    });

    if (!res.ok) {
      throw new AliexpressApiError(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as any;

    if (data.error_response) {
      const err = data.error_response;
      const msg = err.sub_msg || err.msg || 'Erro na API do AliExpress';
      if (!retried && (err.code === 'ApiCallLimit' || String(msg).includes('frequency exceeds'))) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return this.execute<T>(method, businessParams, true);
      }
      throw new AliexpressApiError(msg, err.code, err.sub_code);
    }

    return data as T;
  }
}
