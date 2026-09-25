import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma, forTenant } from '@afilados/db';
import {
  couponVerifySchema,
  extensionCaptureSchema,
  extensionSessionSchema,
  ApiError,
  MARKETPLACE_KINDS,
  type ProductData,
} from '@afilados/shared';
import { hashToken } from './api-tokens';
import { toApiProduct, upsertProducts } from '../lib/products';
import { toApiCoupon } from '../lib/coupons';
import { fetchAwinCatalogByUrls } from '../lib/awin-catalog';
import {
  getAliexpressAdapter,
  getShopeeAdapter,
  getTagAdapter,
  loadAliexpressCredentials,
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

  // 1.5 Lista as automações ativas do tenant, para a extensão escolher destino da captura
  app.get('/extension/automations', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const db = forTenant(tenantId);
    const rules = await db.automationRule.findMany({
      where: { enabled: true },
      select: { id: true, name: true, keywords: true, marketplaces: true },
      orderBy: { name: 'asc' },
    });
    return rules;
  });

  // 2. Captura de produto da aba ativa diretamente pela extensão
  app.post('/extension/capture', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const body = extensionCaptureSchema.parse(req.body);

    const tenantDb = forTenant(tenantId);

    let rule: { id: string } | null = null;
    if (body.automationRuleId) {
      rule = await tenantDb.automationRule.findFirst({ where: { id: body.automationRuleId } });
      if (!rule) throw ApiError.notFound('Automação não encontrada');
    }

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
      } else if (body.marketplaceKind === 'ALIEXPRESS') {
        const creds = await loadAliexpressCredentials(tenantDb);
        list = await getAliexpressAdapter().fetchByUrls(creds, [body.url]);
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

    if (
      body.couponCode &&
      body.couponCode.trim().length >= 3 &&
      body.couponCode.trim().toUpperCase() !== 'CUPOM AMAZON'
    ) {
      const couponCode = body.couponCode.trim().toUpperCase();
      const now = new Date();
      const existingCoupon = await tenantDb.coupon.findFirst({
        where: { store: body.marketplaceKind, code: couponCode, scope: '' },
      });
      if (!existingCoupon) {
        await tenantDb.coupon.create({
          // @ts-expect-error tenantId
          data: {
            store: body.marketplaceKind,
            scope: '',
            code: couponCode,
            description: body.title
              ? `Visto em: ${body.title.slice(0, 100)}`
              : 'Cupom capturado pela extensão',
            discountValue: body.couponValue ?? null,
            sourceUrl: body.url,
            origin: 'EXTENSION',
            status: 'UNVERIFIED',
            lastSeenAt: now,
          },
        });
        await app.events.publish(tenantId, { type: 'coupons.updated' });
      } else {
        await tenantDb.coupon.updateMany({
          where: { id: existingCoupon.id },
          data: {
            lastSeenAt: now,
            ...(body.couponValue ? { discountValue: body.couponValue } : {}),
          },
        });
        await app.events.publish(tenantId, { type: 'coupons.updated' });
      }
    }

    if (rule) {
      const queueItem = await tenantDb.automationQueueItem.create({
        // @ts-expect-error tenantId é injetado pela extensão forTenant
        data: { ruleId: rule.id, kind: 'PRODUCT', productId: savedProduct.id, manual: true },
      });
      await app.events.publish(tenantId, { type: 'automation.queue.updated', ruleId: rule.id });
      return {
        ok: true,
        product: toApiProduct(savedProduct),
        automationQueueItem: { id: queueItem.id, ruleId: rule.id },
      };
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

  // 4. Cupons para a extensão (carrinho e captura)
  const extensionCouponQuerySchema = z.object({
    store: z.enum(MARKETPLACE_KINDS).optional(),
  });

  const extensionCouponCreateSchema = z.object({
    store: z.enum(MARKETPLACE_KINDS),
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .transform((s) => s.toUpperCase()),
    description: z.string().max(500).optional(),
    sourceUrl: z.string().url().optional(),
  });

  const idParam = z.object({ id: z.string().min(1) });

  const STATUS_ORDER: Record<string, number> = {
    VALID: 0,
    UNVERIFIED: 1,
    INVALID: 2,
    EXPIRED: 3,
  };

  app.get('/extension/coupons', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const q = extensionCouponQuerySchema.parse(req.query);
    const db = forTenant(tenantId);

    const rows = await db.coupon.findMany({
      where: {
        status: { in: ['VALID', 'UNVERIFIED'] },
        ...(q.store ? { store: q.store } : {}),
      },
      orderBy: { fetchedAt: 'desc' },
    });

    const sorted = [...rows].sort((a, b) => {
      const statusDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      const aTime = a.expiresAt ? a.expiresAt.getTime() : Infinity;
      const bTime = b.expiresAt ? b.expiresAt.getTime() : Infinity;
      if (aTime !== bTime) return aTime - bTime;
      const aFetched = a.fetchedAt ? a.fetchedAt.getTime() : 0;
      const bFetched = b.fetchedAt ? b.fetchedAt.getTime() : 0;
      return bFetched - aFetched;
    });

    return {
      coupons: sorted.map((c) => ({
        id: c.id,
        store: c.store,
        code: c.code,
        description: c.description,
        minSpend: c.minSpend ? Number(c.minSpend) : null,
        discountType: c.discountType,
        discountValue: c.discountValue ? Number(c.discountValue) : null,
        expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
        status: c.status,
        lastVerifiedAt: c.lastVerifiedAt ? c.lastVerifiedAt.toISOString() : null,
      })),
    };
  });

  app.post('/extension/coupons', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const body = extensionCouponCreateSchema.parse(req.body);
    const db = forTenant(tenantId);
    const now = new Date();

    const existing = await db.coupon.findFirst({
      where: { store: body.store, code: body.code, scope: '' },
    });

    let coupon;
    if (existing) {
      await db.coupon.updateMany({
        where: { id: existing.id },
        data: {
          lastSeenAt: now,
          ...(body.sourceUrl ? { sourceUrl: body.sourceUrl } : {}),
          ...(body.description ? { description: body.description } : {}),
        },
      });
      coupon = await db.coupon.findFirst({ where: { id: existing.id } });
    } else {
      coupon = await db.coupon.create({
        // @ts-expect-error tenantId
        data: {
          store: body.store,
          scope: '',
          code: body.code,
          description: body.description ?? 'Capturado pela extensão',
          sourceUrl: body.sourceUrl ?? null,
          origin: 'EXTENSION',
          status: 'UNVERIFIED',
          lastSeenAt: now,
        },
      });
    }

    await app.events.publish(tenantId, { type: 'coupons.updated' });
    return { ok: true, coupon: toApiCoupon(coupon!) };
  });

  app.post('/extension/coupons/:id/verification', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const { id } = idParam.parse(req.params);
    const body = couponVerifySchema.parse(req.body);
    const db = forTenant(tenantId);

    const coupon = await db.coupon.findFirst({ where: { id } });
    if (!coupon) throw ApiError.notFound('Cupom não encontrado');

    const now = new Date();
    await db.$transaction([
      db.couponCheck.create({
        data: {
          tenantId,
          couponId: id,
          result: body.result,
          method: 'EXTENSION',
          note: body.note ?? null,
          createdAt: now,
        },
      }),
      db.coupon.updateMany({
        where: { id },
        data: {
          status: body.result,
          lastVerifiedAt: now,
        },
      }),
    ]);

    await app.events.publish(tenantId, { type: 'coupons.updated' });
    return { ok: true, status: body.result };
  });
}
