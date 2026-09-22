import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptJson } from '@afilados/db';
import {
  ApiError,
  MARKETPLACE_KINDS,
  QUEUE_AWIN_IMPORT,
  marketplaceKindParam,
  marketplaceUpdateSchema,
  marketplaceSessionSchema,
  parseCookieString,
  supportsSessionCookie,
  SESSION_FIELD_BY_KIND,
  type AwinImportJob,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import {
  getAdapter,
  getShopeeAdapter,
  loadAwinCredentials,
  publicConnection,
  selectableAwinFeeds,
  upsertMarketplaceCredentials,
} from '../lib/marketplaces';
import { getQueue } from '../lib/redis';
import { listDatafeeds } from '@afilados/marketplaces';

const kindParams = z.object({ kind: marketplaceKindParam });

export async function marketplacesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/marketplaces', async (req) => {
    const rows = await req.db.marketplaceConnection.findMany();
    return MARKETPLACE_KINDS.map((kind) =>
      publicConnection(rows.find((r) => r.kind === kind) ?? null, kind),
    );
  });

  app.put('/marketplaces/:kind', async (req) => {
    const { kind } = kindParams.parse(req.params);
    const body = marketplaceUpdateSchema.parse(req.body);
    const row = await upsertMarketplaceCredentials(
      req.db,
      kind,
      (prev) =>
        kind === 'SHOPEE'
          ? { appId: body.appId ?? prev.appId, secret: body.secret ?? prev.secret }
          : kind === 'ALIEXPRESS'
            ? {
                appKey: body.appKey ?? prev.appKey,
                appSecret: body.appSecret ?? prev.appSecret,
                trackingId: body.trackingId ?? body.affiliateTag ?? prev.trackingId,
              }
          : kind === 'AWIN'
            ? {
                feedListUrl: body.feedListUrl ?? prev.feedListUrl,
                // Sem link salvo antes (1ª configuração ou credencial do formato antigo), os
                // feedIds guardados não vieram da lista real — começa a seleção do zero.
                feedIds: body.feedIds ?? (prev.feedListUrl ? (prev.feedIds ?? []) : []),
              }
            : kind === 'MERCADOLIVRE'
              ? {
                  mattWord: body.mattWord ?? prev.mattWord,
                  mattTool: body.mattTool ?? prev.mattTool,
                  // sessão sincronizada pela extensão/manualmente não é editável aqui; só preservada
                  ...(prev.mlSession ? { mlSession: prev.mlSession } : {}),
                }
              : {
                  tag: body.affiliateTag ?? prev.tag,
                  // sessão manual (Amazon/Magalu) não é editável aqui; só preservada
                  ...(prev.amazonSession ? { amazonSession: prev.amazonSession } : {}),
                  ...(prev.magaluSession ? { magaluSession: prev.magaluSession } : {}),
                  // Client ID/Secret da Creators API só são substituídos quando os dois vêm
                  // juntos no body; caso contrário preserva o que já estava salvo (ou undefined).
                  ...(kind === 'AMAZON'
                    ? {
                        amazonApi:
                          body.amazonClientId && body.amazonClientSecret
                            ? { clientId: body.amazonClientId, clientSecret: body.amazonClientSecret }
                            : prev.amazonApi,
                      }
                    : {}),
                },
      (merged, existing) => ({
        status: 'UNCONFIGURED',
        lastError: null,
        affiliateTag:
          kind === 'MERCADOLIVRE'
            ? (merged.mattWord ?? null)
            : kind === 'ALIEXPRESS'
              ? (merged.trackingId ?? null)
              : (body.affiliateTag ?? existing?.affiliateTag ?? null),
      }),
    );
    return publicConnection(row, kind);
  });

  app.post('/marketplaces/:kind/check', async (req) => {
    const { kind } = kindParams.parse(req.params);
    const row = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    if (!row?.encryptedCredentials)
      throw new ApiError('SHOPEE_UNCONFIGURED', 'Configure as credenciais', 400);
    const result =
      kind === 'SHOPEE'
        ? await getShopeeAdapter().checkConnection(
            decryptJson(Buffer.from(row.encryptedCredentials)),
          )
        : await getAdapter(kind).checkConnection(
            decryptJson(Buffer.from(row.encryptedCredentials)),
          );
    await req.db.marketplaceConnection.updateMany({
      where: { id: row.id },
      data: {
        status: result.ok ? 'OK' : 'ERROR',
        lastCheckedAt: new Date(),
        lastError: result.error ?? null,
      },
    });
    return publicConnection(
      await req.db.marketplaceConnection.findFirst({ where: { kind } }),
      kind,
    );
  });

  app.post('/marketplaces/:kind/session', async (req) => {
    const { kind } = kindParams.parse(req.params);
    if (!supportsSessionCookie(kind)) {
      throw new ApiError('MARKETPLACE_ERROR', `${kind} não aceita cookie de sessão`, 400);
    }
    const { cookie } = marketplaceSessionSchema.parse(req.body);
    const cookies = parseCookieString(cookie, kind);
    if (Object.keys(cookies).length === 0) {
      throw ApiError.validation('Cookie inválido ou vazio');
    }
    const sessionField = SESSION_FIELD_BY_KIND[kind];
    const syncedAt = new Date().toISOString();
    const row = await upsertMarketplaceCredentials(
      req.db,
      kind,
      (prev) => ({
        ...prev,
        [sessionField]: { cookies, syncedAt, source: 'manual' },
      }),
      () => ({ status: 'OK', lastCheckedAt: new Date(), lastError: null }),
    );
    return publicConnection(row, kind);
  });

  app.get('/marketplaces/awin/feeds', async (req) => {
    const creds = await loadAwinCredentials(req.db);
    let entries;
    try {
      entries = await listDatafeeds(creds.feedListUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new ApiError('MARKETPLACE_ERROR', message, 502);
    }
    const selected = new Set(creds.feedIds);
    const feeds = selectableAwinFeeds(entries).map((f) => ({
      feedId: f.feedId,
      advertiserName: f.advertiserName,
      region: f.region,
      format: f.format,
      productCount: f.productCount,
      selected: selected.has(f.feedId),
    }));
    return { feeds };
  });

  app.post('/marketplaces/awin/import', async (req) => {
    // Valida as credenciais antes de enfileirar — sem isso, um tenant sem AWIN configurada
    // recebe { queued: true } mas o job roda e não faz nada (importAwinCatalog retorna []).
    const creds = await loadAwinCredentials(req.db);
    if (!creds.feedIds.length) {
      throw new ApiError('MARKETPLACE_ERROR', 'Selecione ao menos um programa para importar', 400);
    }
    const q = getQueue<AwinImportJob>(QUEUE_AWIN_IMPORT);
    await q.add(
      'awin-import',
      { tenantId: req.tenantId },
      { jobId: `awin-import-${req.tenantId}-${Date.now()}`, attempts: 2, removeOnComplete: true, removeOnFail: 50 },
    );
    return { queued: true };
  });
}
