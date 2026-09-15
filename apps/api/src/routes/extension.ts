import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma, forTenant } from '@afilados/db';
import {
  extensionCaptureSchema,
  extensionSessionSchema,
  ApiError,
  type ProductData,
} from '@afilados/shared';
import { getAdapter } from '@afilados/marketplaces';
import { hashToken } from './api-tokens';
import { toApiProduct, upsertProducts } from '../lib/products';

interface AuthenticatedExtensionRequest extends FastifyRequest {
  tenantId: string;
}

async function authenticateExtension(req: FastifyRequest): Promise<{ tenantId: string; tenantName: string }> {
  // 1. Tenta API Token no header Authorization ou x-api-key
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];
  let rawToken: string | undefined;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === 'string') {
    rawToken = apiKeyHeader.trim();
  }

  if (rawToken && rawToken.startsWith('afil_')) {
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

  // 2. Fallback para sessão de cookie se estiver autenticado no web
  if ((req as unknown as { tenantId?: string }).tenantId) {
    const tId = (req as unknown as { tenantId: string }).tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tId } });
    if (tenant) return { tenantId: tId, tenantName: tenant.name };
  }

  throw ApiError.unauthorized('Token de API ou sessão inválida');
}

export async function extensionRoutes(app: FastifyInstance) {
  // 1. Validar conexão da extensão
  app.post('/extension/auth', async (req) => {
    const { tenantId, tenantName } = await authenticateExtension(req);
    return {
      ok: true,
      tenantId,
      tenantName,
    };
  });

  // 2. Captura de produto da aba ativa diretamente pela extensão
  app.post('/extension/capture', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const body = extensionCaptureSchema.parse(req.body);

    let productData: ProductData;
    if (body.title && body.price !== undefined) {
      // Produto já veio com metadados extraídos pelo content script
      productData = {
        source: body.marketplaceKind,
        title: body.title,
        price: body.price,
        originalPrice: body.originalPrice,
        images: body.images ?? [],
        shipping: body.shipping ?? 'UNKNOWN',
        couponCode: body.couponCode,
        couponValue: body.couponValue,
        flashSaleEndsAt: body.flashSaleEndsAt,
        originalUrl: body.url,
        raw: { source: 'extension-capture', ...body },
      };
    } else {
      // Faz scraping via adapter
      const adapter = getAdapter(body.marketplaceKind);
      const list = await adapter.fetchByUrls({}, [body.url]);
      const first = list[0];
      if (!first) {
        throw ApiError.validation('Não foi possível extrair os dados da página');
      }
      productData = first;
    }

    const tenantDb = forTenant(tenantId);
    const [savedProduct] = await upsertProducts(tenantDb, tenantId, [productData]);
    if (!savedProduct) {
      throw new ApiError('DATABASE_ERROR', 'Falha ao salvar produto', 500);
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

  // 3. Sincronização de cookies/sessão de afiliados (para Mercado Livre e lojas com login)
  app.post('/extension/session', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const { marketplaceKind, cookies } = extensionSessionSchema.parse(req.body);

    // Salva ou atualiza os cookies em Settings ou MarketplaceConnection
    await prisma.setting.upsert({
      where: {
        tenantId_key: {
          tenantId,
          key: `cookies:${marketplaceKind.toLowerCase()}`,
        },
      },
      update: {
        value: cookies as any,
      },
      create: {
        tenantId,
        key: `cookies:${marketplaceKind.toLowerCase()}`,
        value: cookies as any,
      },
    });

    return { ok: true, marketplaceKind };
  });
}
