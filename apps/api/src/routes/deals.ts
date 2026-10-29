import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, forTenant } from '@afilados/db';
import { ApiError } from '@afilados/shared';
import {
  getDealsShowcase,
  getDealDetailBySlug,
  ensureDealsPopulated,
} from '../lib/price-engine';

const dealsQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  allTimeLowOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(24),
});

const alertBodySchema = z.object({
  recipient: z.string().min(3, 'Informe um WhatsApp ou E-mail válido'),
  targetPrice: z.coerce.number().positive().optional().nullable(),
  notifyOnAnyDrop: z.boolean().optional().default(false),
  channel: z.enum(['WHATSAPP', 'EMAIL']).optional().default('WHATSAPP'),
});

const slugParamSchema = z.object({
  slug: z.string().min(1),
});

async function resolveTenantId(requestTenantId?: string): Promise<string | null> {
  if (requestTenantId) return requestTenantId;

  // 1. Tenta achar tenant que já possui MasterProduct
  const withMaster = await prisma.masterProduct.findFirst({ select: { tenantId: true } });
  if (withMaster?.tenantId) return withMaster.tenantId;

  // 2. Tenta achar o tenant que possui produtos cadastrados na tabela Product
  const withProduct = await prisma.product.findFirst({
    select: { tenantId: true },
    orderBy: { createdAt: 'desc' },
  });
  if (withProduct?.tenantId) return withProduct.tenantId;

  // 3. Tenta achar o tenant que possui produtos da Awin
  const withAwin = await prisma.awinCatalogProduct.findFirst({
    select: { tenantId: true },
  });
  if (withAwin?.tenantId) return withAwin.tenantId;

  // 4. Superadmin fallback
  const ownerUser = await prisma.user.findFirst({
    where: { isSuperAdmin: true },
    select: { tenantId: true },
  });
  if (ownerUser?.tenantId) return ownerUser.tenantId;

  // 5. Primeiro tenant
  const firstTenant = await prisma.tenant.findFirst({ select: { id: true } });
  return firstTenant?.id ?? null;
}

export async function dealsRoutes(app: FastifyInstance) {
  /**
   * Vitrine pública de ofertas agregadas e comparadas pelo PriceEngine.
   */
  app.get('/deals', async (req, reply) => {
    const q = dealsQuerySchema.parse(req.query);
    const tenantId = await resolveTenantId(req.tenantId);

    if (!tenantId) {
      return reply.send({ total: 0, page: 1, limit: q.limit, totalPages: 0, deals: [] });
    }

    const db = forTenant(tenantId);

    // Auto-popula a vitrine se MasterProduct ainda não tiver itens
    await ensureDealsPopulated(db, tenantId).catch((err) => {
      req.log.warn({ err }, 'Falha silenciosa ao auto-popular deals');
    });

    const result = await getDealsShowcase(db, {
      ...(q.q ? { query: q.q } : {}),
      ...(q.category ? { category: q.category } : {}),
      allTimeLowOnly: q.allTimeLowOnly === 'true',
      page: q.page,
      limit: q.limit,
    });

    return reply.send(result);
  });

  /**
   * Força sincronização de produtos existentes de Product e AwinCatalogProduct para a vitrine.
   */
  app.post('/deals/sync', async (req, reply) => {
    const tenantId = await resolveTenantId(req.tenantId);
    if (!tenantId) {
      throw ApiError.validation('Nenhum tenant encontrado para sincronizar');
    }

    const db = forTenant(tenantId);
    await ensureDealsPopulated(db, tenantId);

    const count = await db.masterProduct.count();
    return reply.send({ ok: true, masterProductsCount: count });
  });

  /**
   * Categorias distintas com contagem de produtos canônicos.
   */
  app.get('/deals/categories', async (req, reply) => {
    const tenantId = await resolveTenantId(req.tenantId);
    if (!tenantId) return reply.send([]);

    const categories = await prisma.masterProduct.groupBy({
      by: ['category'],
      where: {
        tenantId,
        category: { not: null },
      },
      _count: {
        _all: true,
      },
      orderBy: {
        _count: {
          category: 'desc',
        },
      },
    });

    return reply.send(
      categories.map((c) => ({
        category: c.category,
        count: c._count._all,
      })),
    );
  });

  /**
   * Detalhes de um produto canônico, comparador de preços entre lojas e histórico.
   */
  app.get('/deals/:slug', async (req, reply) => {
    const { slug } = slugParamSchema.parse(req.params);
    const tenantId = await resolveTenantId(req.tenantId);

    if (!tenantId) {
      throw ApiError.notFound('Produto não encontrado');
    }

    const db = forTenant(tenantId);
    const deal = await getDealDetailBySlug(db, slug);

    if (!deal) {
      throw ApiError.notFound('Produto não encontrado');
    }

    return reply.send(deal);
  });

  /**
   * Cadastro de alerta de preço para o produto.
   */
  app.post('/deals/:slug/alerts', async (req, reply) => {
    const { slug } = slugParamSchema.parse(req.params);
    const body = alertBodySchema.parse(req.body);
    const tenantId = await resolveTenantId(req.tenantId);

    if (!tenantId) {
      throw ApiError.validation('Serviço temporariamente indisponível');
    }

    const master = await prisma.masterProduct.findFirst({
      where: { tenantId, slug },
      select: { id: true, title: true, currentBestPrice: true },
    });

    if (!master) {
      throw ApiError.notFound('Produto não encontrado para criar alerta');
    }

    const currentPrice = Number(master.currentBestPrice);
    const alreadyMet = body.targetPrice ? currentPrice <= body.targetPrice : false;

    const alert = await prisma.priceAlert.create({
      data: {
        tenantId,
        masterProductId: master.id,
        recipient: body.recipient.trim(),
        targetPrice: body.targetPrice ?? null,
        notifyOnAnyDrop: body.notifyOnAnyDrop ?? false,
        channel: body.channel,
        triggered: alreadyMet,
        triggeredAt: alreadyMet ? new Date() : null,
        lastNotifiedPrice: alreadyMet ? currentPrice : null,
      },
    });

    return reply.status(201).send({
      ok: true,
      alertId: alert.id,
      productTitle: master.title,
      currentBestPrice: currentPrice,
      status: alreadyMet
        ? 'O produto já está abaixo do valor desejado! Enviando notificação agora.'
        : 'Alerta configurado com sucesso! Você será avisado assim que o preço cair.',
    });
  });
}
