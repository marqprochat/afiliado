import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '@afilados/db';

export interface OfferClickInput {
  tenantId: string;
  listingId: string;
  channelCode: string | null;
  batchId: string | null;
}

/** Grava o clique no botão "comprar". Nunca lança: o redirecionamento não pode falhar por isso. */
export async function recordOfferClick(
  input: OfferClickInput,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<boolean> {
  try {
    await prisma.offerClick.create({ data: input });
    return true;
  } catch (err) {
    log?.error({ err, listingId: input.listingId }, 'falha ao registrar clique na oferta');
    return false;
  }
}
