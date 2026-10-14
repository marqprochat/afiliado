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
  matchesSearchKeywords,
  type MarketplaceKind,
  type ProductData,
  type ProductEnrichJob,
  type ProductsImportItem,
  type SearchQuery,
} from '@afilados/shared';
import {
  discoverAmazonByKeyword,
  discoverMercadoLivreByKeyword,
  discoverMlCatalogUrls,
  discoverMagaluByKeyword,
  AmazonListingError,
  MlListingError,
} from '@afilados/marketplaces';
import { requireAuth } from '../plugins/auth';
import {
  getAliexpressAdapter,
  getShopeeAdapter,
  getTagAdapter,
  loadAliexpressCredentials,
  loadShopeeCredentials,
} from '../lib/marketplaces';
import { loadFetchCredentials, loadMlSessionCookies } from '../lib/ml-api';
import {
  amazonListingDeps,
  loadAmazonSessionCookies,
  mapAmazonListingError,
  toAmazonListingSource,
} from '../lib/amazon-listing';
import { mapMlListingError, mlListingDeps, toMlListingSource } from '../lib/ml-listing';
import { toApiProduct, upsertProducts } from '../lib/products';
import { getQueue } from '../lib/redis';
import { searchAwinCatalog, fetchAwinCatalogByUrls } from '../lib/awin-catalog';
import { parseSpreadsheetBuffer, parseSpreadsheetText } from '../lib/spreadsheet';

const idsQuery = z.object({ ids: z.string().min(1) });

/** Filtros de preço/desconto/vendas/frete aplicados depois da busca, iguais para qualquer
 * marketplace — nenhuma das APIs de origem tem todos esses filtros nativos (a Shopee não tem
 * nenhum filtro de preço; o AliExpress tem só min/max preço, aplicado também na query em
 * getAliexpressAdapter().search para não desperdiçar página de resultado; ML/Amazon/Magalu/Awin
 * não têm filtro nenhum, pois vêm de scraping/CSV). Aplicar aqui garante o mesmo comportamento
 * em todo lugar, mesmo quando a origem já filtrou por conta própria. */
function applySearchFilters(products: ProductData[], q: SearchQuery): ProductData[] {
  return products.filter((p) => {
    if (q.minPrice !== undefined && p.price < q.minPrice) return false;
    if (q.maxPrice !== undefined && p.price > q.maxPrice) return false;
    if (q.minDiscountPct !== undefined && (p.discountPct ?? 0) < q.minDiscountPct) return false;
    if (q.minSales !== undefined && (p.salesCount ?? 0) < q.minSales) return false;
    if (q.freeShippingOnly && p.shipping !== 'FREE') return false;
    return true;
  });
}

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
      const rows = await upsertProducts(req.db, req.tenantId, applySearchFilters(found, q));
      return { products: rows.map(toApiProduct) };
    }

    if (q.source === 'ALIEXPRESS') {
      const creds = await loadAliexpressCredentials(req.db);
      let found: ProductData[];
      try {
        found = await getAliexpressAdapter().search!(creds, q);
      } catch (e) {
        throw new ApiError('MARKETPLACE_ERROR', e instanceof Error ? e.message : String(e), 502);
      }
      const rows = await upsertProducts(req.db, req.tenantId, applySearchFilters(found, q));
      return { products: rows.map(toApiProduct) };
    }

    if (q.source === 'AWIN') {
      if (!q.query) throw ApiError.validation('Informe uma palavra-chave');
      const found = await searchAwinCatalog(req.db, q.query, q.limit);
      const rows = await upsertProducts(req.db, req.tenantId, applySearchFilters(found, q));
      return { products: rows.map(toApiProduct) };
    }

    // Amazon por listagem de ofertas: busca por palavra-chave no departamento Ofertas ou a página
    // Mega Oferta Prime. Os filtros rodam durante a paginação, como no Mercado Livre.
    if (q.mode === 'listing' && q.source === 'AMAZON') {
      const cookies = await loadAmazonSessionCookies(req.db);
      let found: ProductData[];
      try {
        found = await amazonListingDeps.fetchAmazonListing(
          toAmazonListingSource(q.amazonListing!, q.query),
          {
            limit: q.limit,
            filter: (p) =>
              applySearchFilters([p], { ...q, freeShippingOnly: false }).length > 0 &&
              (!q.freeShippingOnly || p.shipping === 'FREE') &&
              // a vitrine Mega Oferta Prime não tem busca própria: a palavra-chave filtra pelo título
              (q.amazonListing!.kind === 'deals' ||
                !q.query ||
                matchesSearchKeywords(p.title, q.query)),
            ...(cookies ? { cookies } : {}),
          },
        );
      } catch (e) {
        if (e instanceof AmazonListingError) {
          if (e.details) {
            req.log.warn(
              { code: e.code, details: e.details },
              'busca por listagem da Amazon falhou',
            );
          }
        } else {
          req.log.warn({ err: e }, 'busca por listagem da Amazon falhou com erro inesperado');
        }
        throw mapAmazonListingError(e, Boolean(cookies));
      }
      const rows = await upsertProducts(req.db, req.tenantId, found);
      return { products: rows.map(toApiProduct) };
    }

    // Mercado Livre por listagem de ofertas (a busca por palavra-chave é bloqueada pelo anti-bot).
    if (q.mode === 'listing') {
      const cookies = await loadMlSessionCookies(req.db);
      let found: ProductData[];
      try {
        found = await mlListingDeps.fetchMlListing(toMlListingSource(q.mlListing!), {
          limit: q.limit,
          // filtra durante a paginação para juntar `limit` produtos que passem nos filtros
          filter: (p) => {
            // Full que também diz "grátis" no card (raw.freeShipping) vale como frete grátis
            const freeShipping =
              p.shipping === 'FREE' ||
              (p.raw as { freeShipping?: unknown } | undefined)?.freeShipping === true;
            return (
              applySearchFilters([p], { ...q, freeShippingOnly: false }).length > 0 &&
              (!q.freeShippingOnly || freeShipping) &&
              // a listagem não tem busca própria: a palavra-chave filtra pelo título dos cards
              (!q.query || matchesSearchKeywords(p.title, q.query))
            );
          },
          ...(cookies ? { cookies } : {}),
        });
      } catch (e) {
        if (e instanceof MlListingError) {
          if (e.details) {
            req.log.warn({ code: e.code, details: e.details }, 'busca por listagem do ML falhou');
          }
        } else {
          req.log.warn({ err: e }, 'busca por listagem do ML falhou com erro inesperado');
        }
        throw mapMlListingError(e, Boolean(cookies));
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
    // Mercado Livre com a API oficial conectada: busca no catálogo (a raspagem é bloqueada pelo
    // anti-bot). Só ML carrega as credenciais antes; Amazon e Magalu mantêm a ordem de sempre.
    const mlCreds = kind === 'MERCADOLIVRE' ? await loadFetchCredentials(req.db, kind) : undefined;
    const mlToken = mlCreds?.mlApi?.accessToken;
    let urls: string[];
    try {
      urls = mlToken
        ? await discoverMlCatalogUrls(q.query!, mlToken)
        : await discoverUrlsForKeyword(kind, q.query!);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('MARKETPLACE_ERROR', e instanceof Error ? e.message : String(e), 502);
    }
    if (urls.length === 0) return { products: [] };
    const creds = mlCreds ?? (await loadFetchCredentials(req.db, kind));
    const found = await getTagAdapter(kind).fetchByUrls(creds, urls.slice(0, q.limit));
    const rows = await upsertProducts(req.db, req.tenantId, applySearchFilters(found, q));
    return { products: rows.map(toApiProduct) };
  });

  app.post('/products/import', async (req) => {
    let urls: string[] = [];
    let itemsWithMeta: ProductsImportItem[] = [];

    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw ApiError.validation('Arquivo ausente');
      const buffer = await file.toBuffer();
      const parsedItems = parseSpreadsheetBuffer(buffer);
      if (parsedItems.length === 0) {
        throw ApiError.validation('Nenhum link ou produto encontrado na planilha');
      }
      itemsWithMeta = parsedItems.filter((i) => i.title !== undefined);
      urls = parsedItems.filter((i) => i.title === undefined).map((i) => i.url);
    } else {
      const body = productsImportSchema.parse(req.body);
      if (body.text) {
        const parsedItems = parseSpreadsheetText(body.text);
        if (parsedItems.length > 0) {
          itemsWithMeta = parsedItems.filter((i) => i.title !== undefined);
          urls = parsedItems.filter((i) => i.title === undefined).map((i) => i.url);
        } else {
          urls = [...new Set(body.text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
        }
      } else {
        const metaItems = body.items ?? [];
        itemsWithMeta = metaItems.filter((i) => i.title !== undefined);
        urls = [
          ...(body.urls ?? []),
          ...metaItems.filter((i) => i.title === undefined).map((i) => i.url),
        ];
      }
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
    const queuedUrls: {
      kind: Exclude<MarketplaceKind, 'SHOPEE' | 'AWIN' | 'ALIEXPRESS'>;
      url: string;
    }[] = [];
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
        raw: { source: 'spreadsheet-import', ...item },
      });
    }

    // Se temos itens de AliExpress sem imagens (como os vindos de planilha),
    // tenta puxar as fotos pela API oficial rápida se credenciais estiverem conectadas.
    const aliNoImages = allFound.filter((p) => p.source === 'ALIEXPRESS' && p.images.length === 0);
    if (aliNoImages.length > 0) {
      try {
        const aliCreds = await loadAliexpressCredentials(req.db);
        const aliFound = await getAliexpressAdapter().fetchByUrls(
          aliCreds,
          aliNoImages.map((p) => p.originalUrl),
        );
        const imgMap = new Map(aliFound.map((f) => [f.externalId, f.images]));
        for (const p of aliNoImages) {
          const imgs = p.externalId ? imgMap.get(p.externalId) : undefined;
          if (imgs && imgs.length > 0) p.images = imgs;
        }
      } catch {
        // Sem credenciais do AliExpress ou erro de rede; o worker product-enrich cuidará disso
      }
    }

    // Shopee e AliExpress usam APIs oficiais (rápidas) e respondem de forma síncrona.
    // ML/Amazon/Magalu exigem scraping: uma URL só é resolvida na hora; lotes vão para a fila
    // product-enrich, que enriquece em background com cache e rate-limit gentil.
    const scrapeInline = urls.length === 1;

    for (const [kind, kindUrls] of groupedByKind.entries()) {
      try {
        if (kind === 'SHOPEE') {
          const { creds } = await loadShopeeCredentials(req.db);
          const found = await getShopeeAdapter().fetchByUrls(creds, kindUrls);
          allFound.push(...found);
        } else if (kind === 'ALIEXPRESS') {
          const creds = await loadAliexpressCredentials(req.db);
          const found = await getAliexpressAdapter().fetchByUrls(creds, kindUrls);
          allFound.push(...found);
        } else if (kind === 'AWIN') {
          const found = await fetchAwinCatalogByUrls(req.db, kindUrls);
          allFound.push(...found);
          const foundUrls = new Set(found.map((f) => f.originalUrl));
          for (const u of kindUrls) {
            if (!foundUrls.has(u)) {
              unsupported.push({
                url: u,
                reason: 'Produto Awin não encontrado no catálogo importado',
              });
            }
          }
        } else if (scrapeInline) {
          const creds = await loadFetchCredentials(req.db, kind);
          const found = await getTagAdapter(kind).fetchByUrls(creds, kindUrls);
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

      // Produtos que precisam de enriquecimento de imagem em background:
      // 1. stubs (ML/Amazon sem dados)
      // 2. produtos de planilha que ainda estão com imagens vazias (ex: AliExpress sem API oficial)
      const needEnrichRows = rows
        .slice(0, allFound.length)
        .filter((r) => r.images.length === 0 && r.source !== 'MANUAL');

      const allEnrichItems = [
        ...stubRows.map((row, i) => ({
          row,
          url: queuedUrls[i]!.url,
          kind: queuedUrls[i]!.kind as ProductEnrichJob['marketplaceKind'],
        })),
        ...needEnrichRows.map((row) => ({
          row,
          url: row.originalUrl,
          kind: row.source as ProductEnrichJob['marketplaceKind'],
        })),
      ];

      if (allEnrichItems.length) {
        const queue = getQueue<ProductEnrichJob>(QUEUE_PRODUCT_ENRICH);
        await queue.addBulk(
          allEnrichItems.map(({ row, url, kind }) => ({
            name: 'enrich',
            data: {
              tenantId: req.tenantId,
              productId: row.id,
              url,
              marketplaceKind: kind,
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
