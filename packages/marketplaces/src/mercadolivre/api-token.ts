import { createHash, randomBytes } from 'node:crypto';
import { MlApiError } from './api';

// OAuth do app do Mercado Livre (authorization_code + PKCE, refresh_token). Lógica pura: quem chama
// injeta `save` (gravar o token no banco) — ver o design em
// docs/superpowers/specs/2026-09-29-mercadolivre-api-oficial-design.md.

const AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
/** Renova quando faltar menos que isso para vencer. */
const RENEW_SKEW_MS = 5 * 60 * 1000;

export interface MlOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface MlApiTokens {
  /** De uso único: cada renovação devolve um novo e o anterior deixa de valer. */
  refreshToken: string;
  accessToken?: string | undefined;
  /** ISO 8601. */
  expiresAt?: string | undefined;
  userId?: string | undefined;
  connectedAt?: string | undefined;
}

export interface MlOAuthOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildMlAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${query}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: number | string;
  error?: string;
  message?: string;
}

async function requestTokens(
  form: Record<string, string>,
  opts: MlOAuthOptions,
): Promise<TokenResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    // A mensagem nunca inclui o client_secret nem tokens: só o erro devolvido pelo Mercado Livre.
    const detail = [body.error, body.message].filter(Boolean).join(': ') || `HTTP ${res.status}`;
    const code = res.status >= 400 && res.status < 500 ? 'ML_API_UNAUTHORIZED' : 'ML_API_ERROR';
    throw new MlApiError(`Mercado Livre recusou o token (${detail})`, code, res.status);
  }
  return body;
}

function toTokens(
  body: TokenResponse,
  fallbackRefresh: string | undefined,
  now: number,
): MlApiTokens {
  const refreshToken = body.refresh_token ?? fallbackRefresh;
  if (!refreshToken) {
    throw new MlApiError(
      'Mercado Livre não devolveu refresh_token (falta o escopo offline_access?)',
      'ML_API_ERROR',
    );
  }
  return {
    refreshToken,
    accessToken: body.access_token,
    expiresAt: new Date(now + (body.expires_in ?? 21600) * 1000).toISOString(),
    ...(body.user_id !== undefined ? { userId: String(body.user_id) } : {}),
  };
}

export async function exchangeMlCode(
  cfg: MlOAuthConfig,
  params: { code: string; redirectUri: string; verifier: string },
  opts: MlOAuthOptions = {},
): Promise<MlApiTokens> {
  const now = (opts.now ?? Date.now)();
  const body = await requestTokens(
    {
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.verifier,
    },
    opts,
  );
  return { ...toTokens(body, undefined, now), connectedAt: new Date(now).toISOString() };
}

export async function refreshMlTokens(
  cfg: MlOAuthConfig,
  refreshToken: string,
  opts: MlOAuthOptions = {},
): Promise<MlApiTokens> {
  const now = (opts.now ?? Date.now)();
  const body = await requestTokens(
    {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
    },
    opts,
  );
  return toTokens(body, refreshToken, now);
}

/**
 * Devolve um access token válido. Se o atual vence em menos de 5 minutos (ou não existe), renova e
 * GRAVA o novo refresh_token (via `save`) antes de devolver o access token: o refresh anterior é de
 * uso único, então perder o novo valor derrubaria a conexão. Se a renovação falhar, nada é gravado.
 */
export async function ensureMlAccessToken(
  tokens: MlApiTokens,
  cfg: MlOAuthConfig,
  save: (tokens: MlApiTokens) => Promise<void>,
  opts: MlOAuthOptions = {},
): Promise<{ accessToken: string; tokens: MlApiTokens }> {
  const now = (opts.now ?? Date.now)();
  if (
    tokens.accessToken &&
    tokens.expiresAt &&
    Date.parse(tokens.expiresAt) - now > RENEW_SKEW_MS
  ) {
    return { accessToken: tokens.accessToken, tokens };
  }
  const refreshed = await refreshMlTokens(cfg, tokens.refreshToken, opts);
  const next: MlApiTokens = {
    ...refreshed,
    userId: refreshed.userId ?? tokens.userId,
    connectedAt: tokens.connectedAt,
  };
  await save(next);
  return { accessToken: next.accessToken!, tokens: next };
}
