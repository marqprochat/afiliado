import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '@afilados/db';

export interface LinkClickInput {
  tenantId: string;
  groupLinkId: string;
  slug: string;
  targetGroupJid: string | null;
}

/** Grava o clique e incrementa o contador acumulado. Nunca lança: o redirecionamento não pode falhar por isso. */
export async function recordLinkClick(
  input: LinkClickInput,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.linkClickEvent.create({ data: input }),
      prisma.groupLink.update({
        where: { id: input.groupLinkId },
        data: { clickCount: { increment: 1 } },
      }),
    ]);
    return true;
  } catch (err) {
    log?.error(
      { err, groupLinkId: input.groupLinkId },
      'falha ao registrar clique no link de grupo',
    );
    return false;
  }
}
