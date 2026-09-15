import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { parse } from 'csv-parse/sync';
import { parseProductUrl } from '@afilados/core';
import { getAdapter } from '@afilados/marketplaces';
import { productsImportSchema, searchQuerySchema, ApiError, type MarketplaceKind } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getShopeeAdapter, loadShopeeCredentials } from '../lib/marketplaces';
import { toApiProduct, upsertProducts } from '../lib/products';

export async function productsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  app.addHook('preHandler', requireAuth);

  app.post('/products/search', async (req) => {
    const q = searchQuerySchema.parse(req.body);
    if (q.source !== 'SHOPEE') throw ApiError.validation(`${q.source} não possui API de busca por catálogo; use a importação por links ou a extensão`);
    const { creds } = await loadShopeeCredentials(req.db);
    let found;
    try {
      found = await getShopeeAdapter().search!(creds, q);
    } catch (e) {
      throw new ApiError('MARKETPLACE_ERROR', e instanceof Error ? e.message : String(e), 502);
    }
    const rows = await upsertProducts(req.db, req.tenantId, found);
    return { products: rows.map(toApiProduct) };
  });

  app.post('/products/import', async (req) => {
    let urls: string[];
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
      urls = productsImportSchema.parse(req.body).urls;
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

    const allFound: any[] = [];
    let lastError: Error | null = null;

    for (const [kind, kindUrls] of groupedByKind.entries()) {
      try {
        if (kind === 'SHOPEE') {
          const { creds } = await loadShopeeCredentials(req.db);
          const found = await getShopeeAdapter().fetchByUrls(creds, kindUrls);
          allFound.push(...found);
        } else {
          const adapter = getAdapter(kind);
          const found = await adapter.fetchByUrls({}, kindUrls);
          allFound.push(...found);
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        for (const u of kindUrls) {
          unsupported.push({ url: u, reason: lastError.message });
        }
      }
    }

    if (urls.length === 1 && allFound.length === 0 && lastError) {
      throw new ApiError('MARKETPLACE_ERROR', lastError.message, 502);
    }

    let products: ReturnType<typeof toApiProduct>[] = [];
    if (allFound.length) {
      products = (await upsertProducts(req.db, req.tenantId, allFound)).map(toApiProduct);
    }

    return { products, unsupported };
  });
}
