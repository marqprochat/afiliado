import { prisma, decryptJson, encryptJson } from '@afilados/db';
import type { TagCredentials } from '@afilados/shared';
import {
  MlApiError,
  ensureMlAccessToken,
  type AliexpressCredentials,
  type AwinCredentials,
  type MlApiTokens,
  type MlOAuthConfig,
  type TagKind,
} from '@afilados/marketplaces';
import { config } from '../config';
import { getRedis } from './redis';

/**
 * Carrega e decripta as credenciais de um marketplace por tag (ML/Amazon/Magalu) do tenant.
 * Só é preciso de verdade para a Amazon (Creators API) — Mercado Livre e Magalu continuam
 * raspando HTML por URL e não usam nada daqui, mas a função aceita os três por uniformidade.
 */
export async function loadTagCredentials(
  tenantId: string,
  kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): Promise<TagCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } });
  const creds = row?.encryptedCredentials
    ? decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials))
    : {};
  if (kind === 'AMAZON' && (!creds.amazonApi?.clientId || !creds.amazonApi?.clientSecret)) {
    throw new Error('AMAZON: configure Client ID/Secret da Creators API');
  }
  return creds;
}

export async function loadAwinCredentials(tenantId: string): Promise<AwinCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'AWIN' } });
  const creds = row?.encryptedCredentials
    ? decryptJson<AwinCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AwinCredentials>);
  if (!creds.feedListUrl) {
    throw new Error('AWIN: configure o link da lista de feeds');
  }
  return {
    feedListUrl: creds.feedListUrl,
    feedIds: creds.feedIds ?? [],
    publisherId: creds.publisherId,
    offersApiToken: creds.offersApiToken,
  };
}

export async function loadAliexpressCredentials(tenantId: string): Promise<AliexpressCredentials> {
  const row = await prisma.marketplaceConnection.findFirst({
    where: { tenantId, kind: 'ALIEXPRESS' },
  });
  const creds = row?.encryptedCredentials
    ? decryptJson<AliexpressCredentials>(Buffer.from(row.encryptedCredentials))
    : ({} as Partial<AliexpressCredentials>);
  if (!creds.appKey || !creds.appSecret || !creds.trackingId) {
    throw new Error('ALIEXPRESS: configure App Key, App Secret e Tracking ID');
  }
  return creds as AliexpressCredentials;
}

// --- API oficial do Mercado Livre (mesma lógica de apps/api/src/lib/ml-api.ts; ver o design em
// docs/superpowers/specs/2026-09-29-mercadolivre-api-oficial-design.md) ---

const REFRESH_LOCK_TTL_MS = 30_000;
const WAIT_STEP_MS = 500;
const WAIT_STEPS = 20;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function mlOAuthConfig(): MlOAuthConfig | null {
  const clientId = config.ML_CLIENT_ID?.trim();
  const clientSecret = config.ML_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function readMlRow(tenantId: string) {
  const row = await prisma.marketplaceConnection.findFirst({
    where: { tenantId, kind: 'MERCADOLIVRE' },
  });
  const creds = row?.encryptedCredentials
    ? decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials))
    : {};
  return { row, creds };
}

async function saveMlTokens(tenantId: string, tokens: MlApiTokens): Promise<void> {
  const { row, creds } = await readMlRow(tenantId);
  if (!row) return;
  await prisma.marketplaceConnection.update({
    where: { id: row.id },
    data: { encryptedCredentials: encryptJson({ ...creds, mlApi: tokens }) },
  });
}

/** Renova sob lock no Redis (o refresh_token é de uso único e a API também pode renovar). */
async function ensureMlTokenWithLock(
  tenantId: string,
  tokens: MlApiTokens,
  cfg: MlOAuthConfig,
): Promise<{ accessToken: string; tokens: MlApiTokens }> {
  const redis = getRedis();
  const key = `ml-api-refresh:${tenantId}`;
  const acquired = await redis.set(key, '1', 'PX', REFRESH_LOCK_TTL_MS, 'NX');
  if (acquired) {
    try {
      const latest = (await readMlRow(tenantId)).creds.mlApi ?? tokens;
      return await ensureMlAccessToken(latest, cfg, (t) => saveMlTokens(tenantId, t));
    } finally {
      await redis.del(key);
    }
  }
  for (let i = 0; i < WAIT_STEPS; i++) {
    await sleep(WAIT_STEP_MS);
    const latest = (await readMlRow(tenantId)).creds.mlApi;
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
 * Credenciais do ML com `mlApi.accessToken` válido. Sem integração configurada/conectada, ou se a
 * renovação falhar, devolve as credenciais SEM `mlApi` — o adapter mantém então a raspagem atual.
 */
export async function loadMlApiCredentials(tenantId: string): Promise<TagCredentials> {
  const { row, creds } = await readMlRow(tenantId);
  const cfg = mlOAuthConfig();
  if (!row || !creds.mlApi?.refreshToken || !cfg) return creds;
  try {
    const { accessToken, tokens } = await ensureMlTokenWithLock(tenantId, creds.mlApi, cfg);
    return { ...creds, mlApi: { ...tokens, accessToken } };
  } catch (err) {
    if (err instanceof MlApiError && err.code === 'ML_API_UNAUTHORIZED') {
      await prisma.marketplaceConnection.update({
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

/** Credenciais para `getTagAdapter(kind).fetchByUrls`: Amazon (Creators API), ML (API oficial) ou nada. */
export async function loadFetchCredentials(
  tenantId: string,
  kind: TagKind,
): Promise<TagCredentials> {
  if (kind === 'AMAZON') return loadTagCredentials(tenantId, kind);
  if (kind === 'MERCADOLIVRE') return loadMlApiCredentials(tenantId);
  return {};
}
