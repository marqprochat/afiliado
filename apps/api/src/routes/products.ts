import type { FastifyInstance, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { parseProductUrl } from '@afilados/core';
import {
  productsImportSchema,
  searchQuerySchema,
  ApiError,
  QUEUE_PRODUCT_ENRICH,
  type MarketplaceKind,
  type ProductData,
  type ProductEnrichJob,
  type ProductsImportItem,
} from '@afilados/shared';
import {
  discoverAmazonByKeyword,
  discoverMercadoLivreByKeyword,
  discoverMagaluByKeyword,
} from '@afilados/marketplaces';
import { requireAuth } from '../plugins/auth';
import { getShopeeAdapter, getTagAdapter, loadShopeeCredentials } from '../lib/marketplaces';
import { toApiProduct, upsertProducts } from '../lib/products';
import { getQueue } from '../lib/redis';

const idsQuery = z.object({ ids: z.string().min(1) });

/** Busca por palavra-chave fora da Shopee, best-effort e anônima. ML/Magalu bloqueiam esse tipo
 * de busca mesmo autenticados (confirmado em testes com navegador headless) — o caminho que
 * realmente funciona para eles é a extensão Afilados Connect (botão "Copiar links"). */
async function discoverUrlsForKeyword(
  kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  keyword: string,
): Promise<string[]> {
  if (kind === 'AMAZON') return discoverAmazonByKeyword(keyword);
  return kind === 'MERCADOLIVRE'
    ? discoverMercadoLivreByKeyword(keyword)
    : discoverMagaluByKeyword(keyword);
}

export async function productsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  app.addHook('preHandler', requireAuth);

  // Busca por ids (usado pela web para atualizar produtos enriquecidos em background)
  app.get('/products', async (req) => {
    const ids = idsQuery.parse(req.query).ids.split(',').filter(Boolean).slice(0, 200);
    const rows = await req.db.product.findMany({ where: { id: { in: ids } } });
    return { products: rows.map(toApiProduct) };
  });

  app.post('/products/search', async (req) => {
    const q = searchQuerySchema.parse(req.body);

    if (q.source === 'SHOPEE') {
      const { creds } = await loadShopeeCredentials(req.db);
      let found: ProductData[];
      try {
        found = await getShopeeAdapter().search!(creds, q);
      } catch (e) {
        throw new ApiError('MARKETPLACE_ERROR', e instanceof Error ? e.message : String(e), 502);
      }
      const rows = await upsertProducts(req.db, req.tenantId, found);
      return { products: rows.map(toApiProduct) };
    }

    // Mercado Livre, Amazon e Magalu não têm API de catálogo/categoria — só busca por
    // palavra-chave, reaproveitando os mesmos scrapers/sessão usados pela automação (Plano 2).
    if (q.mode !== 'keyword') {
      throw ApiError.validation(
        `${q.source}: só a busca por palavra-chave está disponível fora da Shopee`,
      );
    }
    const kind = q.source as 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU';
    let urls: string[];
    try {
      urls = await discoverUrlsForKeyword(kind, q.query!);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('MARKETPLACE_ERROR', e instanceof Error ? e.message : String(e), 502);
    }
    if (urls.length === 0) return { products: [] };
    const found = await getTagAdapter(kind).fetchByUrls({}, urls.slice(0, q.limit));
    const rows = await upsertProducts(req.db, req.tenantId, found);
    return { products: rows.map(toApiProduct) };
  });

  app.post('/products/import', async (req) => {
    let urls: string[];
    let itemsWithMeta: ProductsImportItem[] = [];
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw ApiError.validation('Arquivo CSV ausente');
      const text = (await file.toBuffer()).toString('utf8');
      const records = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as {
        url?: string;
      }[];
      urls = records.map((r) => r.url ?? '').filter(Boolean);
      if (urls.length === 0) throw ApiError.validation('CSV sem coluna url');
    } else {
      const body = productsImportSchema.parse(req.body);
      // Itens com título já vieram com metadados extraídos pela extensão direto do DOM da
      // página (busca/listagem) — pulamos o scraping do backend, que para ML/Magalu esbarra
      // em bloqueio anti-bot e não retorna dados reais. Itens sem título caem no fluxo normal.
      const metaItems = body.items ?? [];
      itemsWithMeta = metaItems.filter((i) => i.title !== undefined);
      urls = [...(body.urls ?? []), ...metaItems.filter((i) => i.title === undefined).map((i) => i.url)];
    }

    const unsupported: { url: string; reason: string }[] = [];
    const groupedByKind = new Map<MarketplaceKind, string[]>();

    for (const url of urls) {
      const p = parseProductUrl(url);
      if (p.source === 'UNSUPPORTED') {
        unsupported.push({ url, reason: p.reason });
      } else {
        const list = groupedByKind.get(p.source) ?? [];
        list.push(url);
        groupedByKind.set(p.source, list);
      }
    }

    const allFound: ProductData[] = [];
    const queuedUrls: { kind: Exclude<MarketplaceKind, 'SHOPEE'>; url: string }[] = [];
    let lastError: Error | null = null;

    for (const item of itemsWithMeta) {
      const parsed = parseProductUrl(item.url);
      if (parsed.source === 'UNSUPPORTED') {
        unsupported.push({ url: item.url, reason: parsed.reason });
        continue;
      }
      allFound.push({
        source: parsed.source,
        externalId: parsed.externalId,
        title: item.title!,
        price: item.price ?? 0,
        originalPrice: item.originalPrice,
        discountPct: item.discountPct,
        images: item.images ?? [],
        shipping: item.shipping ?? 'UNKNOWN',
        couponCode: item.couponCode,
        originalUrl: item.url,
        raw: { source: 'extension-listing-capture', ...item },
      });
    }

    // Shopee usa a API oficial (rápida) e responde de forma síncrona.
    // ML/Amazon/Magalu exigem scraping: uma URL só é resolvida na hora; lotes vão para a fila
    // product-enrich, que enriquece em background com cache e rate-limit gentil.
    const scrapeInline = urls.length === 1;

    for (const [kind, kindUrls] of groupedByKind.entries()) {
      try {
        if (kind === 'SHOPEE') {
          const { creds } = await loadShopeeCredentials(req.db);
          const found = await getShopeeAdapter().fetchByUrls(creds, kindUrls);
          allFound.push(...found);
        } else if (scrapeInline) {
          const found = await getTagAdapter(kind).fetchByUrls({}, kindUrls);
          allFound.push(...found);
        } else {
          for (const url of kindUrls) queuedUrls.push({ kind, url });
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        for (const u of kindUrls) {
          unsupported.push({ url: u, reason: lastError.message });
        }
      }
    }

    if (urls.length === 1 && allFound.length === 0 && queuedUrls.length === 0 && lastError) {
      throw new ApiError('MARKETPLACE_ERROR', lastError.message, 502);
    }

    // Produtos-esqueleto para os que serão enriquecidos em background
    const stubs: ProductData[] = queuedUrls.map(({ kind, url }) => {
      const parsed = parseProductUrl(url);
      return {
        source: kind,
        ...(parsed.source !== 'UNSUPPORTED' ? { externalId: parsed.externalId } : {}),
        title: 'Importando…',
        price: 0,
        images: [],
        shipping: 'UNKNOWN',
        originalUrl: url,
        raw: { pendingEnrich: true, url },
      };
    });

    let products: ReturnType<typeof toApiProduct>[] = [];
    if (allFound.length || stubs.length) {
      const rows = await upsertProducts(req.db, req.tenantId, [...allFound, ...stubs]);
      products = rows.map(toApiProduct);
      const stubRows = rows.slice(allFound.length);
      if (stubRows.length) {
        const queue = getQueue<ProductEnrichJob>(QUEUE_PRODUCT_ENRICH);
        await queue.addBulk(
          stubRows.map((row, i) => ({
            name: 'enrich',
            data: {
              tenantId: req.tenantId,
              productId: row.id,
              url: queuedUrls[i]!.url,
              marketplaceKind: queuedUrls[i]!.kind,
            },
            opts: {
              jobId: `enrich-${row.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: 50,
            },
          })),
        );
      }
    }

    return { products, unsupported, queued: stubs.length };
  });
}
