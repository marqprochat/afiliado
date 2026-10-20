import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptJson, prisma, resolveConnections } from '@afilados/db';
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
import { forbidAffiliate, requireAuth } from '../plugins/auth';
import {
  getAdapter,
  getShopeeAdapter,
  MARKETPLACE_UNAVAILABLE_MESSAGE,
  loadAliexpressCredentials,
  loadAwinCredentials,
  publicAffiliateConnection,
  publicConnection,
  selectableAwinFeeds,
  setAffiliateSubId,
  upsertMarketplaceCredentials,
} from '../lib/marketplaces';
import { getQueue, getQueueEvents, getRedis } from '../lib/redis';
import { completeMlOAuth, startMlOAuth } from '../lib/ml-api';
import { readMlLinkBatchError } from '../lib/ml-links';
import { getAliexpressCategories, listDatafeeds } from '@afilados/marketplaces';

const kindParams = z.object({ kind: marketplaceKindParam });
const mlOAuthCallbackSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

export async function marketplacesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/marketplaces', async (req) => {
    if (req.isAffiliate) {
      const [owner, own] = await Promise.all([
        resolveConnections(req.tenantId),
        req.db.marketplaceConnection.findMany(),
      ]);
      return MARKETPLACE_KINDS.map((kind) =>
        publicAffiliateConnection(
          owner.get(kind)?.row ?? null,
          own.find((r) => r.kind === kind) ?? null,
          kind,
        ),
      );
    }
    const rows = await req.db.marketplaceConnection.findMany();
    const mlLinkBatchError = await readMlLinkBatchError(req.tenantId);
    return MARKETPLACE_KINDS.map((kind) => {
      const conn = publicConnection(rows.find((r) => r.kind === kind) ?? null, kind);
      return kind === 'MERCADOLIVRE' ? { ...conn, mlLinkBatchError } : conn;
    });
  });

  app.put('/marketplaces/:kind', async (req) => {
    const { kind } = kindParams.parse(req.params);
    if (req.isAffiliate) {
      const { subId } = z
        .object({ subId: z.string().trim().max(60) })
        .strict()
        .parse(req.body);
      await setAffiliateSubId(req.db, kind, subId);
      const [owner, own] = await Promise.all([
        resolveConnections(req.tenantId),
        req.db.marketplaceConnection.findFirst({ where: { kind } }),
      ]);
      return publicAffiliateConnection(owner.get(kind)?.row ?? null, own, kind);
    }
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
                  publisherId: body.publisherId !== undefined ? body.publisherId : prev.publisherId,
                  offersApiToken:
                    body.offersApiToken !== undefined ? body.offersApiToken : prev.offersApiToken,
                }
              : kind === 'MERCADOLIVRE'
                ? {
                    mattWord: body.mattWord ?? prev.mattWord,
                    mattTool: body.mattTool ?? prev.mattTool,
                    // etiqueta do gerador meli.la; string vazia limpa (volta à etiqueta padrão da conta)
                    tag: body.mlTag !== undefined ? body.mlTag || undefined : prev.tag,
                    // sessão sincronizada pela extensão/manualmente não é editável aqui; só preservada
                    ...(prev.mlSession ? { mlSession: prev.mlSession } : {}),
                    // conexão OAuth com a API oficial: só muda pelo fluxo /oauth; aqui só é preservada
                    ...(prev.mlApi ? { mlApi: prev.mlApi } : {}),
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
                              ? {
                                  clientId: body.amazonClientId,
                                  clientSecret: body.amazonClientSecret,
                                }
                              : prev.amazonApi,
                        }
                      : {}),
                  },
      (merged, existing) => {
        const onlyAwinFeedSelection =
          kind === 'AWIN' &&
          body.feedIds !== undefined &&
          body.feedListUrl === undefined &&
          body.publisherId === undefined &&
          body.offersApiToken === undefined;
        return {
          status: onlyAwinFeedSelection ? (existing?.status ?? 'UNCONFIGURED') : 'UNCONFIGURED',
          ...(onlyAwinFeedSelection
            ? {
                lastError: existing?.lastError ?? null,
                lastCheckedAt: existing?.lastCheckedAt ?? null,
              }
            : { lastError: null }),
          affiliateTag:
            kind === 'MERCADOLIVRE'
              ? (merged.mattWord ?? null)
              : kind === 'ALIEXPRESS'
                ? (merged.trackingId ?? null)
                : (body.affiliateTag ?? existing?.affiliateTag ?? null),
        };
      },
    );
    return publicConnection(row, kind);
  });

  app.post('/marketplaces/:kind/check', { preHandler: forbidAffiliate }, async (req) => {
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

  app.post('/marketplaces/:kind/session', { preHandler: forbidAffiliate }, async (req) => {
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

  // API oficial do Mercado Livre: OAuth (o app fica no .env; aqui só o fluxo de autorização)
  app.post('/marketplaces/mercadolivre/oauth/start', { preHandler: forbidAffiliate }, async (req) =>
    startMlOAuth(req.tenantId),
  );

  app.post(
    '/marketplaces/mercadolivre/oauth/callback',
    { preHandler: forbidAffiliate },
    async (req) => {
      const { code, state } = mlOAuthCallbackSchema.parse(req.body);
      await completeMlOAuth(req.db, req.tenantId, code, state);
      return publicConnection(
        await req.db.marketplaceConnection.findFirst({ where: { kind: 'MERCADOLIVRE' } }),
        'MERCADOLIVRE',
      );
    },
  );

  app.delete('/marketplaces/mercadolivre/oauth', { preHandler: forbidAffiliate }, async (req) => {
    const row = await upsertMarketplaceCredentials(
      req.db,
      'MERCADOLIVRE',
      (prev) => {
        const { mlApi: _removed, ...rest } = prev;
        return rest;
      },
      (_merged, existing) => ({ status: existing?.status ?? 'UNCONFIGURED' }),
    );
    return publicConnection(row, 'MERCADOLIVRE');
  });

  app.get('/marketplaces/awin/feeds', { preHandler: forbidAffiliate }, async (req) => {
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

  app.get('/marketplaces/aliexpress/categories', async (req) => {
    const creds = await loadAliexpressCredentials(req.db);
    try {
      const categories = await getAliexpressCategories(creds);
      return { categories };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (req.isAffiliate) {
        req.log.warn({ tenantId: req.tenantId, err: message }, 'aliexpress/categories falhou');
        throw new ApiError('MARKETPLACE_UNAVAILABLE', MARKETPLACE_UNAVAILABLE_MESSAGE, 502);
      }
      throw new ApiError('MARKETPLACE_ERROR', message, 502);
    }
  });

  app.get('/marketplaces/awin/import/:jobId', async (req) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(req.params);
    if (
      req.isAffiliate ||
      !(jobId === `awin-import-${req.tenantId}` || jobId.startsWith(`awin-import-${req.tenantId}-`))
    ) {
      throw new ApiError('NOT_FOUND', 'Importação não encontrada', 404);
    }
    const job = await getQueue<AwinImportJob>(QUEUE_AWIN_IMPORT).getJob(jobId);
    if (!job) throw new ApiError('NOT_FOUND', 'Importação não encontrada ou expirada', 404);
    const state = await job.getState();
    const error =
      state === 'failed'
        ? req.isAffiliate
          ? MARKETPLACE_UNAVAILABLE_MESSAGE
          : job.failedReason || 'Falha na importação'
        : undefined;
    const result =
      state === 'completed'
        ? (job.returnvalue as {
            feedId: string;
            ok: boolean;
            imported: number;
            removed: number;
            error?: string;
          }[])
        : undefined;
    return {
      jobId,
      state,
      progress: job.progress,
      result:
        req.isAffiliate && result
          ? result.map((feed) =>
              feed.error ? { ...feed, error: MARKETPLACE_UNAVAILABLE_MESSAGE } : feed,
            )
          : result,
      error,
    };
  });

  app.post(
    '/marketplaces/awin/import/:jobId/cancel',
    { preHandler: forbidAffiliate },
    async (req) => {
      const { jobId } = z.object({ jobId: z.string().min(1).max(200) }).parse(req.params);
      if (
        jobId !== `awin-import-${req.tenantId}` &&
        !jobId.startsWith(`awin-import-${req.tenantId}-`)
      ) {
        throw new ApiError('NOT_FOUND', 'Awin import not found', 404);
      }
      const q = getQueue<AwinImportJob>(QUEUE_AWIN_IMPORT);
      const job = await q.getJob(jobId);
      if (!job) return { cancelled: false, state: 'not-found' };
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
        await job.remove();
        return { cancelled: true, state: 'cancelled' };
      }
      if (state === 'active') {
        await getRedis().set(`awin-import:cancel:${jobId}`, '1', 'EX', 3600);
        await job.updateProgress({ phase: 'cancelling' });
        return { cancelled: true, state: 'cancelling' };
      }
      return { cancelled: false, state };
    },
  );

  app.post('/marketplaces/awin/import', { preHandler: forbidAffiliate }, async (req) => {
    // Valida as credenciais antes de enfileirar — sem isso, um tenant sem AWIN configurada
    // recebe { queued: true } mas o job roda e não faz nada (importAwinCatalog retorna []).
    const creds = await loadAwinCredentials(req.db);
    if (!creds.feedIds.length) {
      throw new ApiError('MARKETPLACE_ERROR', 'Selecione ao menos um programa para importar', 400);
    }
    const q = getQueue<AwinImportJob>(QUEUE_AWIN_IMPORT);
    const affiliates = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Tenant" WHERE "parentTenantId" = ${req.tenantId}
    `;
    const familyIds = new Set([req.tenantId, ...affiliates.map((tenant) => tenant.id)]);
    const [activeJobs, waitingJobs, delayedJobs] = await Promise.all([
      q.getActive(),
      q.getWaiting(),
      q.getDelayed(),
    ]);
    for (const oldJob of [...activeJobs, ...waitingJobs, ...delayedJobs]) {
      if (!familyIds.has(oldJob.data.tenantId)) continue;
      const oldState = await oldJob.getState();
      if (oldState === 'active') {
        await getRedis().set(`awin-import:cancel:${oldJob.id}`, '1', 'EX', 3600);
        await oldJob.updateProgress({ phase: 'cancelling' });
      } else if (oldState === 'waiting' || oldState === 'delayed') {
        await oldJob.remove();
      }
    }
    const job = await q.add(
      'awin-import',
      { tenantId: req.tenantId },
      {
        jobId: `awin-import-${req.tenantId}-${Date.now()}`,
        attempts: 2,
        removeOnComplete: { age: 24 * 60 * 60, count: 100 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 50 },
      },
    );
    // A espera precisa ficar abaixo do timeout de 30s do proxy do Next (rewrites): acima disso o
    // proxy derruba a conexão e o usuário vê HTTP 500 sem a API nunca responder.
    // Aguarda o job terminar para devolver quantos produtos foram encontrados pelo link do
    // feed — sem isso o usuário só via "os produtos aparecem em alguns minutos" e não tinha
    // como saber se o import funcionou ou trouxe 0 produtos (link/feed inválido ou expirado).
    try {
      const results = (await job.waitUntilFinished(getQueueEvents(QUEUE_AWIN_IMPORT), 20_000)) as {
        feedId: string;
        ok: boolean;
        imported: number;
        removed: number;
        error?: string;
      }[];
      const totalImported = results.reduce((sum, r) => sum + r.imported, 0);
      const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);
      const failed = results.filter((r) => !r.ok);
      return {
        queued: false,
        totalImported,
        totalRemoved,
        failedCount: failed.length,
        feeds: req.isAffiliate
          ? results.map((r) => {
              if (!r.error) return r;
              req.log.warn(
                { tenantId: req.tenantId, feedId: r.feedId, err: r.error },
                'awin import falhou',
              );
              return { ...r, error: MARKETPLACE_UNAVAILABLE_MESSAGE };
            })
          : results,
      };
    } catch {
      // Timeout (feed grande) ou job perdido: cai no fluxo assíncrono anterior — o worker
      // continua processando em background e o catálogo é atualizado de qualquer forma.
      return { queued: true, jobId: job.id };
    }
  });
}
