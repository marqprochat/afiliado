/**
 * Cliente da Creators API da Amazon (sucessora oficial da PA-API 5.0), usada para buscar
 * dados de produto (GetItems) com as credenciais de Associado do tenant.
 *
 * Doc: https://associados.amazon.com.br/creatorsapi/docs/en-us/introduction
 * Spec: docs/superpowers/specs/2026-09-21-amazon-creators-api-design.md
 */

const AMAZON_TOKEN_ENDPOINT_DEFAULT = 'https://api.amazon.com/auth/o2/token';
const AMAZON_CREATORS_API_BASE_URL_DEFAULT = 'https://creatorsapi.amazon';
const AMAZON_CREATORS_API_MARKETPLACE_BR = 'www.amazon.com.br';
/** Cota inicial da Creators API é 1 TPS — mantemos esse teto fixo mesmo quando a conta ganha mais. */
const MIN_REQUEST_INTERVAL_MS = 1000;
/** Renova o token um pouco antes de expirar, para não arriscar usar um token vencido em voo. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class AmazonApiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'AMAZON_API_UNAUTHORIZED'
      | 'AMAZON_API_RATE_LIMITED'
      | 'AMAZON_API_ITEM_NOT_FOUND'
      | 'AMAZON_API_ERROR',
  ) {
    super(message);
    this.name = 'AmazonApiError';
  }
}

export interface AmazonApiCredentials {
  clientId: string;
  clientSecret: string;
  partnerTag: string;
}

export interface AmazonApiOptions {
  fetchImpl?: typeof fetch;
  tokenEndpoint?: string;
  baseUrl?: string;
  marketplace?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const lastCallAt = new Map<string, number>();

/** Limpa os caches em memória — só para uso em testes, evita estado vazando entre `it`s. */
export function resetAmazonApiState(): void {
  tokenCache.clear();
  lastCallAt.clear();
}

export async function getAccessToken(
  creds: Pick<AmazonApiCredentials, 'clientId' | 'clientSecret'>,
  opts: AmazonApiOptions = {},
): Promise<string> {
  const cached = tokenCache.get(creds.clientId);
  if (cached && cached.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS) {
    return cached.token;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.tokenEndpoint ?? AMAZON_TOKEN_ENDPOINT_DEFAULT;
  const res = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'creatorsapi::default',
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new AmazonApiError('Credenciais da Creators API inválidas', 'AMAZON_API_UNAUTHORIZED');
  }
  if (!res.ok) {
    throw new AmazonApiError(`Token da Creators API respondeu HTTP ${res.status}`, 'AMAZON_API_ERROR');
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new AmazonApiError('Resposta de token sem access_token', 'AMAZON_API_ERROR');
  }
  const expiresIn = data.expires_in ?? 3600;
  tokenCache.set(creds.clientId, { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  return data.access_token;
}

/** Espera o mínimo necessário para respeitar 1 req/s por `clientId` antes de uma chamada. */
export async function waitForRateLimitSlot(clientId: string): Promise<void> {
  const last = lastCallAt.get(clientId) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastCallAt.set(clientId, Date.now());
}

export {
  AMAZON_TOKEN_ENDPOINT_DEFAULT,
  AMAZON_CREATORS_API_BASE_URL_DEFAULT,
  AMAZON_CREATORS_API_MARKETPLACE_BR,
};
