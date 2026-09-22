import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma, forTenant } from '@afilados/db';
import {
  extensionCaptureSchema,
  extensionSessionSchema,
  ApiError,
  type ProductData,
} from '@afilados/shared';
import { hashToken } from './api-tokens';
import { toApiProduct, upsertProducts } from '../lib/products';
import { fetchAwinCatalogByUrls } from '../lib/awin-catalog';
import {
  getShopeeAdapter,
  getTagAdapter,
  loadShopeeCredentials,
  loadTagCredentials,
  upsertMarketplaceCredentials,
} from '../lib/marketplaces';

async function authenticateExtension(
  req: FastifyRequest,
): Promise<{ tenantId: string; tenantName: string }> {
  // 1. Tenta API Token no header Authorization ou x-api-key
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];
  let rawToken: string | undefined;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === 'string') {
    rawToken = apiKeyHeader.trim();
  }

  if (rawToken) {
    if (rawToken.startsWith('afil_')) {
      const tokenHash = hashToken(rawToken);
      const tokenRow = await prisma.apiToken.findFirst({
        where: { tokenHash, revokedAt: null },
        include: { tenant: true },
      });

      if (tokenRow) {
        // Atualiza lastUsedAt em background
        void prisma.apiToken.update({
          where: { id: tokenRow.id },
          data: { lastUsedAt: new Date() },
        });
        return { tenantId: tokenRow.tenantId, tenantName: tokenRow.tenant.name };
      }
    }
    // Se forneceu um token mas ele não existe ou foi revogado:
    throw ApiError.unauthorized('Token de API inválido ou revogado');
  }

  // 2. Se nenhum token foi passado, permite sessão autenticada por cookie (ex: requisições feitas do painel web)
  if ((req as unknown as { tenantId?: string }).tenantId) {
    const tId = (req as unknown as { tenantId: string }).tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tId } });
    if (tenant) return { tenantId: tId, tenantName: tenant.name };
  }

  throw ApiError.unauthorized('Token de API não fornecido');
}

export async function extensionRoutes(app: FastifyInstance) {
  // 1. Validar conexão da extensão (aceita GET e POST)
  app.route({
    method: ['GET', 'POST'],
    url: '/extension/auth',
    handler: async (req) => {
      const { tenantId, tenantName } = await authenticateExtension(req);
      return {
        ok: true,
        tenantId,
        tenantName,
      };
    },
  });

  // 2. Captura de produto da aba ativa diretamente pela extensão
  app.post('/extension/capture', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const body = extensionCaptureSchema.parse(req.body);

    const tenantDb = forTenant(tenantId);
    let productData: ProductData;
    if (body.title && body.price !== undefined && body.price !== null) {
      // Produto já veio com metadados extraídos pelo content script
      productData = {
        source: body.marketplaceKind,
        title: body.title,
        price: body.price,
        originalPrice: body.originalPrice ?? undefined,
        discountPct: body.discountPct ?? undefined,
        images: body.images ?? [],
        shipping: body.shipping ?? 'UNKNOWN',
        couponCode: body.couponCode ?? undefined,
        couponValue: body.couponValue ?? undefined,
        flashSaleEndsAt: body.flashSaleEndsAt ?? undefined,
        originalUrl: body.url,
        raw: { source: 'extension-capture', ...body },
      };
    } else {
      // Faz scraping via adapter (Shopee usa a API oficial com as credenciais do tenant)
      let list: ProductData[];
      if (body.marketplaceKind === 'SHOPEE') {
        const { creds } = await loadShopeeCredentials(tenantDb);
        list = await getShopeeAdapter().fetchByUrls(creds, [body.url]);
      } else if (body.marketplaceKind === 'AWIN') {
        list = await fetchAwinCatalogByUrls(tenantDb, [body.url]);
      } else {
        const amazonCreds =
          body.marketplaceKind === 'AMAZON'
            ? await loadTagCredentials(tenantDb, body.marketplaceKind)
            : {};
        list = await getTagAdapter(body.marketplaceKind).fetchByUrls(amazonCreds, [body.url]);
      }
      const first = list[0];
      if (!first) {
        throw ApiError.validation('Não foi possível extrair os dados da página');
      }
      productData = first;
    }

    const [savedProduct] = await upsertProducts(tenantDb, tenantId, [productData]);
    if (!savedProduct) {
      throw new ApiError('INTERNAL', 'Falha ao salvar produto', 500);
    }

    // Adiciona na Fila de Triagem como selecionado
    const queueItem = await prisma.queueItem.upsert({
      where: {
        tenantId_productId: {
          tenantId,
          productId: savedProduct.id,
        },
      },
      update: {
        selected: true,
        status: 'PENDING',
      },
      create: {
        tenantId,
        productId: savedProduct.id,
        selected: true,
        status: 'PENDING',
      },
    });

    await app.events.publish(tenantId, { type: 'queue.updated' });

    return {
      ok: true,
      product: toApiProduct(savedProduct),
      queueItem: {
        id: queueItem.id,
        selected: queueItem.selected,
        status: queueItem.status,
      },
    };
  });

  // 3. Sincronização de cookies/sessão do afiliado (Mercado Livre → link oficial meli.la).
  // Os cookies ficam criptografados junto às demais credenciais da MarketplaceConnection
  // e nunca são devolvidos pela API (só o syncedAt, via publicConnection).
  app.post('/extension/session', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const { marketplaceKind, cookies } = extensionSessionSchema.parse(req.body);
    const db = forTenant(tenantId);

    const syncedAt = new Date().toISOString();
    await upsertMarketplaceCredentials(
      db,
      marketplaceKind,
      (prev) => ({ ...prev, mlSession: { cookies, syncedAt, source: 'extension' } }),
      () => ({ status: 'OK', lastCheckedAt: new Date(), lastError: null }),
    );

    await app.events.publish(tenantId, { type: 'marketplace.updated', kind: marketplaceKind });

    return { ok: true, marketplaceKind, syncedAt, cookieCount: Object.keys(cookies).length };
  });
}
