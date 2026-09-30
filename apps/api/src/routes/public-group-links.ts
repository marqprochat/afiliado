import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afilados/db';
import { ApiError } from '@afilados/shared';
import { getRedis } from '../lib/redis';

const slugParam = z.object({ slug: z.string().min(1) });
const REDIRECT_CACHE_TTL_S = 30;

export async function publicGroupLinksRoutes(app: FastifyInstance) {
  app.get('/public/group-links/:slug', async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    const normalized = slug.trim().toLowerCase();
    const cacheKey = `grouplink:slug:${normalized}`;

    try {
      const cached = await getRedis().get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        return reply.send(data);
      }
    } catch {
      // Falha no cache não interrompe a consulta ao banco
    }

    const link = await prisma.groupLink.findUnique({
      where: { slug: normalized },
      include: {
        groups: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
      },
    });

    if (!link) {
      throw ApiError.notFound('Link não encontrado');
    }

    const activeGroup = link.groups[0] ?? null;

    if (!link.enabled || link.status !== 'ACTIVE' || !activeGroup || !activeGroup.inviteLink) {
      if (link.fallbackUrl) {
        const responseData = {
          ok: true,
          inviteLink: null,
          fallbackUrl: link.fallbackUrl,
          status: link.status,
        };
        try {
          await getRedis().set(cacheKey, JSON.stringify(responseData), 'EX', REDIRECT_CACHE_TTL_S);
        } catch {
          // ignore
        }
        return reply.send(responseData);
      }

      throw new ApiError('SERVICE_UNAVAILABLE', 'Grupo temporariamente indisponível', 503);
    }

    const responseData = {
      ok: true,
      inviteLink: activeGroup.inviteLink,
      fallbackUrl: link.fallbackUrl,
      status: link.status,
    };

    try {
      await getRedis().set(cacheKey, JSON.stringify(responseData), 'EX', REDIRECT_CACHE_TTL_S);
    } catch {
      // ignore
    }

    return reply.send(responseData);
  });
}
