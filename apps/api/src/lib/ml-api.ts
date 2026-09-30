import { randomBytes } from 'node:crypto';
import { decryptJson, type TenantClient } from '@afilados/db';
import {
  MlApiError,
  buildMlAuthUrl,
  ensureMlAccessToken,
  exchangeMlCode,
  generatePkce,
  type MlApiTokens,
  type MlOAuthConfig,
  type TagKind,
} from '@afilados/marketplaces';
import { ApiError, type TagCredentials } from '@afilados/shared';
import { config } from '../config';
import { getRedis } from './redis';
import { loadTagCredentials, upsertMarketplaceCredentials } from './marketplaces';

// Conexão com a API oficial do Mercado Livre (OAuth + renovação do token). Ver o design em
// docs/superpowers/specs/2026-09-29-mercadolivre-api-oficial-design.md.

const STATE_TTL_SEC = 10 * 60;
const REFRESH_LOCK_TTL_MS = 30_000;
const WAIT_STEP_MS = 500;
const WAIT_STEPS = 20;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const stateKey = (state: string) => `ml-oauth:${state}`;
const lockKey = (tenantId: string) => `ml-api-refresh:${tenantId}`;

/** Client ID/Secret do app do Mercado Livre, ou null se a integração não está configurada no servidor. */
export function mlOAuthConfig(): MlOAuthConfig | null {
  const clientId = config.ML_CLIENT_ID?.trim();
  const clientSecret = config.ML_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** DESENVOLVIMENTO=true → localhost; senão https://<DOMAIN>/callbackml (cadastrado igual no DevCenter). */
export function mlRedirectUri(): string {
  const dev = (config.DESENVOLVIMENTO ?? '').trim().toLowerCase();
  if (['true', '1', 'sim', 'yes'].includes(dev)) return 'http://localhost:3000/callback';
  const domain = (config.DOMAIN ?? '').trim().replace(/\/+$/, '');
  if (!domain || domain === 'localhost') {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'Defina DOMAIN com o domínio público do painel (ou DESENVOLVIMENTO=true) no servidor',
      400,
    );
  }
  const base = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  return `${base}/callbackml`;
}

function requireOAuthConfig(): MlOAuthConfig {
  const cfg = mlOAuthConfig();
  if (!cfg) {
    throw new ApiError(
      'MARKETPLACE_ERROR',
      'Defina ML_CLIENT_ID e ML_CLIENT_SECRET no servidor para conectar a API oficial do Mercado Livre',
      400,
    );
  }
  return cfg;
}

/** Inicia a autorização: guarda state + verifier PKCE (10 min) e devolve a URL para o navegador. */
export async function startMlOAuth(
  tenantId: string,
): Promise<{ authUrl: string; redirectUri: string }> {
  const cfg = requireOAuthConfig();
  const redirectUri = mlRedirectUri();
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString('hex');
  await getRedis().set(
    stateKey(state),
    JSON.stringify({ tenantId, verifier }),
    'EX',
    STATE_TTL_SEC,
  );
  const authUrl = buildMlAuthUrl({
    clientId: cfg.clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
  });
  return { authUrl, redirectUri };
}

/** Conclui a autorização: consome o state (uso único), troca o código e grava a conexão. */
export async function completeMlOAuth(
  db: TenantClient,
  tenantId: string,
  code: string,
  state: string,
): Promise<{ connectedAt: string | null }> {
  const cfg = requireOAuthConfig();
  const redis = getRedis();
  const raw = await redis.get(stateKey(state));
  await redis.del(stateKey(state));
  const invalid = new ApiError(
    'MARKETPLACE_ERROR',
    'Autorização expirada ou inválida — refaça a conexão',
    400,
  );
  if (!raw) throw invalid;
  const stored = JSON.parse(raw) as { tenantId: string; verifier: string };
  if (stored.tenantId !== tenantId) throw invalid;

  let tokens: MlApiTokens;
  try {
    tokens = await exchangeMlCode(cfg, {
      code,
      redirectUri: mlRedirectUri(),
      verifier: stored.verifier,
    });
  } catch (err) {
    if (err instanceof MlApiError) throw new ApiError('MARKETPLACE_ERROR', err.message, 400);
    throw err;
  }
  await upsertMarketplaceCredentials(
    db,
    'MERCADOLIVRE',
    (prev) => ({ ...prev, mlApi: tokens }),
    () => ({ status: 'OK', lastCheckedAt: new Date(), lastError: null }),
  );
  return { connectedAt: tokens.connectedAt ?? null };
}

async function readCreds(db: TenantClient) {
  const row = await db.marketplaceConnection.findFirst({ where: { kind: 'MERCADOLIVRE' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials))
    : {};
  return { row, creds };
}

async function saveTokens(db: TenantClient, tokens: MlApiTokens): Promise<void> {
  await upsertMarketplaceCredentials(
    db,
    'MERCADOLIVRE',
    (prev) => ({ ...prev, mlApi: tokens }),
    (_merged, existing) => ({ status: existing?.status ?? 'OK' }),
  );
}

/**
 * Renova o token sob lock no Redis: o refresh_token é de uso único e API e worker podem precisar
 * renovar ao mesmo tempo. Quem não pega o lock espera o outro gravar o token novo.
 */
async function ensureWithLock(
  db: TenantClient,
  tenantId: string,
  tokens: MlApiTokens,
  cfg: MlOAuthConfig,
): Promise<{ accessToken: string; tokens: MlApiTokens }> {
  const redis = getRedis();
  const key = lockKey(tenantId);
  const acquired = await redis.set(key, '1', 'PX', REFRESH_LOCK_TTL_MS, 'NX');
  if (acquired) {
    try {
      // Reler depois de pegar o lock: outro processo pode ter renovado nesse meio tempo.
      const latest = (await readCreds(db)).creds.mlApi ?? tokens;
      return await ensureMlAccessToken(latest, cfg, (t) => saveTokens(db, t));
    } finally {
      await redis.del(key);
    }
  }
  for (let i = 0; i < WAIT_STEPS; i++) {
    await sleep(WAIT_STEP_MS);
    const latest = (await readCreds(db)).creds.mlApi;
    if (
      latest?.accessToken &&
      latest.expiresAt &&
      Date.parse(latest.expiresAt) - Date.now() > 60_000
    ) {
      return { accessToken: latest.accessToken, tokens: latest };
    }
  }
  throw new MlApiError('Renovação do token do Mercado Livre em andamento', 'ML_API_ERROR');
}

/**
 * Credenciais do ML com `mlApi.accessToken` válido (renovado se preciso). Não exige matt_word nem
 * sessão: serve para buscar dados de produto. Se a integração não está configurada/conectada, ou a
 * renovação falha, devolve as credenciais SEM `mlApi` — o adapter então mantém a raspagem atual.
 */
export async function loadMlApiCredentials(db: TenantClient): Promise<TagCredentials> {
  const { row, creds } = await readCreds(db);
  const cfg = mlOAuthConfig();
  if (!row || !creds.mlApi?.refreshToken || !cfg) return creds;
  try {
    const { accessToken, tokens } = await ensureWithLock(db, row.tenantId, creds.mlApi, cfg);
    return { ...creds, mlApi: { ...tokens, accessToken } };
  } catch (err) {
    if (err instanceof MlApiError && err.code === 'ML_API_UNAUTHORIZED') {
      await db.marketplaceConnection.updateMany({
        where: { id: row.id },
        data: {
          lastCheckedAt: new Date(),
          lastError: 'API oficial do Mercado Livre desconectada — conecte de novo em Configurações',
        },
      });
    }
    const { mlApi: _dropped, ...withoutApi } = creds;
    return withoutApi;
  }
}

/**
 * Credenciais para `getTagAdapter(kind).fetchByUrls`: Amazon exige as da Creators API, Mercado Livre
 * usa a API oficial quando conectada, Magalu não precisa de nada.
 */
export async function loadFetchCredentials(
  db: TenantClient,
  kind: TagKind,
): Promise<TagCredentials> {
  if (kind === 'AMAZON') return loadTagCredentials(db, kind);
  if (kind === 'MERCADOLIVRE') return loadMlApiCredentials(db);
  return {};
}
