import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afilados/db';
import { ApiError } from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { recordLinkClick, type LinkClickInput } from '../lib/link-clicks';

const slugParam = z.object({ slug: z.string().min(1) });
const REDIRECT_CACHE_TTL_S = 30;

interface Resolution {
  ok: true;
  inviteLink: string | null;
  fallbackUrl: string | null;
  status: string;
  /** dados do clique; ficam no cache mas nunca vão para o cliente */
  click?: LinkClickInput;
}

export async function publicGroupLinksRoutes(app: FastifyInstance) {
  app.get('/public/group-links/:slug', async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    const normalized = slug.trim().toLowerCase();
    const cacheKey = `grouplink:slug:${normalized}`;

    const respond = async (resolution: Resolution) => {
      const { click, ...body } = resolution;
      if (click) await recordLinkClick(click, req.log);
      return reply.send(body);
    };
    const cache = async (resolution: Resolution) => {
      try {
        await getRedis().set(cacheKey, JSON.stringify(resolution), 'EX', REDIRECT_CACHE_TTL_S);
      } catch {
        // ignore
      }
    };

    let cached: Resolution | null = null;
    try {
      const raw = await getRedis().get(cacheKey);
      if (raw) cached = JSON.parse(raw) as Resolution;
    } catch {
      // Falha no cache não interrompe a consulta ao banco
    }
    if (cached) return respond(cached);

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
    const click: LinkClickInput = {
      tenantId: link.tenantId,
      groupLinkId: link.id,
      slug: link.slug,
      targetGroupJid: null,
    };

    if (!link.enabled || link.status !== 'ACTIVE' || !activeGroup || !activeGroup.inviteLink) {
      if (link.fallbackUrl) {
        const resolution: Resolution = {
          ok: true,
          inviteLink: null,
          fallbackUrl: link.fallbackUrl,
          status: link.status,
          click,
        };
        await cache(resolution);
        return respond(resolution);
      }

      throw new ApiError('SERVICE_UNAVAILABLE', 'Grupo temporariamente indisponível', 503);
    }

    const resolution: Resolution = {
      ok: true,
      inviteLink: activeGroup.inviteLink,
      fallbackUrl: link.fallbackUrl,
      status: link.status,
      click: { ...click, targetGroupJid: activeGroup.jid },
    };
    await cache(resolution);
    return respond(resolution);
  });

  // GET /public/group-links - Lista todos os links de grupos ativos para a landpage de divulgação
  app.get('/public/group-links', async (req, reply) => {
    const links = await prisma.groupLink.findMany({
      where: {
        enabled: true,
        status: 'ACTIVE',
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        groups: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
      },
    });

    const formatted = links.map((link) => {
      const activeGroup = link.groups[0] ?? null;
      return {
        id: link.id,
        slug: link.slug,
        label: link.label,
        baseName: link.baseName,
        customText: link.customText,
        groupDescription: link.groupDescription,
        groupImageBase64: link.groupImageBase64,
        displayOrder: link.displayOrder,
        clickCount: link.clickCount,
        status: link.status,
        memberLimit: link.memberLimit,
        activeGroup: activeGroup
          ? {
              name: activeGroup.name,
              memberCount: activeGroup.memberCount,
            }
          : null,
        redirectUrl: `/g/${link.slug}`,
      };
    });

    return reply.send({
      ok: true,
      data: formatted,
    });
  });
}
