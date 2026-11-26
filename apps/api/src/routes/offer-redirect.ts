import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { prisma } from '@afilados/db';
import { sanitizeTrackParam } from '@afilados/core';
import { withAwinChannelRefs } from '@afilados/marketplaces';
import { ApiError } from '@afilados/shared';
import { recordOfferClick } from '../lib/offer-clicks';
import { resolvePublicTenantId } from './deals';

const paramsSchema = z.object({ listingId: z.string().min(1).max(64) });

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Botão "comprar" do site: `GET /r/:listingId?c=<canal>&b=<lote>` grava o clique e redireciona
 * (302) para o link de afiliado da listagem — na Awin com `clickref2`/`clickref3` do canal/lote.
 */
export async function offerRedirectRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.get('/r/:listingId', async (req, reply) => {
    const { listingId } = paramsSchema.parse(req.params);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const channelCode = sanitizeTrackParam(query.c);
    const batchId = sanitizeTrackParam(query.b);

    const tenantId = await resolvePublicTenantId();
    const listing = tenantId
      ? await prisma.productListing.findFirst({
          where: { id: listingId, tenantId },
          select: { id: true, tenantId: true, affiliateUrl: true, originalUrl: true },
        })
      : null;
    const target = listing?.affiliateUrl || listing?.originalUrl;
    if (!listing || !target || !isHttpUrl(target)) throw ApiError.notFound('Oferta não encontrada');

    await recordOfferClick(
      { tenantId: listing.tenantId, listingId: listing.id, channelCode, batchId },
      req.log,
    );
    const location = withAwinChannelRefs(target, { channel: channelCode, batch: batchId });
    return reply.header('cache-control', 'no-store').redirect(location, 302);
  });
}
