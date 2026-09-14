import { buildShopeeAuthHeader } from './signature';
import type { ShopeeCredentials } from '../adapter';

export const SHOPEE_ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

export class ShopeeApiError extends Error {}

export class ShopeeGraphQLClient {
  constructor(
    private readonly creds: ShopeeCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify({ query, variables });
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await this.fetchImpl(SHOPEE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildShopeeAuthHeader(this.creds.appId, this.creds.secret, payload, timestamp),
      },
      body: payload,
    });
    if (!res.ok) throw new ShopeeApiError(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new ShopeeApiError(json.errors.map((e) => e.message).join('; '));
    if (!json.data) throw new ShopeeApiError('Resposta sem data');
    return json.data;
  }
}
