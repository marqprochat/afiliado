import type { FastifyInstance } from 'fastify';
import { prisma } from '@afilados/db';
import {
  ApiError,
  affiliateLandingUpdateSchema,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';

function generateSlugFromName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'comunidade-vip';
}

export async function affiliateLandingRoutes(app: FastifyInstance) {
  // GET /public/affiliate-landing/:slug - Endpoint público para renderizar a LP do afiliado
  app.get('/public/affiliate-landing/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const cleanSlug = slug.toLowerCase().trim();

    const lp = await prisma.affiliateLandingPage.findUnique({
      where: { slug: cleanSlug },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            active: true,
          },
        },
      },
    });

    if (!lp || !lp.enabled || !lp.tenant.active) {
      throw ApiError.notFound('Página não encontrada ou temporariamente desativada');
    }

    // Busca os grupos VIP vinculados a este tenant
    const groupLinks = await prisma.groupLink.findMany({
      where: {
        tenantId: lp.tenantId,
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

    const formattedGroups = groupLinks.map((link) => {
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
      data: {
        profile: {
          id: lp.id,
          slug: lp.slug,
          title: lp.title || `Comunidade VIP de Ofertas e Cupons · ${lp.authorName}`,
          authorName: lp.authorName,
          authorBadge: lp.authorBadge || 'RADAR VIP · 24H',
          authorBio: lp.authorBio,
          authorImage: lp.authorImage,
          logoText: lp.logoText || lp.authorName.toUpperCase(),
          themeColor: lp.themeColor,
          headline: lp.headline || 'RECEBA OFERTAS SECRETAS, BUGS DE PREÇO E CUPONS REAIS',
          subheadline:
            lp.subheadline ||
            `Pare de pagar caro! Acompanhe em tempo real o radar da equipe de ${lp.authorName} garimpando descontos históricos em grandes lojas.`,
          ctaButtonText: lp.ctaButtonText || 'QUERO ENTRAR NOS GRUPOS VIP',
          stat1Value: lp.stat1Value || '+10K',
          stat1Label: lp.stat1Label || 'Membros VIP',
          stat2Value: lp.stat2Value || 'R$ 500K+',
          stat2Label: lp.stat2Label || 'Economia Gerada',
          stat3Value: lp.stat3Value || '100%',
          stat3Label: lp.stat3Label || 'Links Verificados',
          stat4Value: lp.stat4Value || '24/7',
          stat4Label: lp.stat4Label || 'Radar Ativo',
          youtubeUrl: lp.youtubeUrl,
          instagramUrl: lp.instagramUrl,
          telegramUrl: lp.telegramUrl,
          showBenefits: lp.showBenefits,
          showAuthority: lp.showAuthority,
          showCategories: lp.showCategories,
          showFaq: lp.showFaq,
        },
        groups: formattedGroups,
      },
    });
  });

  // GET /affiliate-landing - Dados de configuração da LP para o tenant autenticado
  app.get('/affiliate-landing', { preHandler: [requireAuth] }, async (req, reply) => {
    const tenantId = req.tenantId;

    const [existing, tenant, user] = await Promise.all([
      prisma.affiliateLandingPage.findUnique({
        where: { tenantId },
      }),
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
      }),
      prisma.user.findFirst({
        where: { tenantId, role: 'OWNER' },
      }),
    ]);

    if (existing) {
      return reply.send({
        ok: true,
        data: existing,
      });
    }

    // Se ainda não existir no banco, gera defaults inteligentes baseados no nome do tenant
    const defaultAuthor = tenant.name || user?.name || 'Comunidade VIP';
    const suggestedSlug = generateSlugFromName(defaultAuthor);

    const defaults = {
      id: null,
      tenantId,
      slug: suggestedSlug,
      enabled: true,
      title: `Grupos VIP de Ofertas e Cupons · ${defaultAuthor}`,
      authorName: defaultAuthor,
      authorBadge: 'RADAR VIP · 24H',
      authorBio: `Monitoramento contínuo de preços e cupons das melhores lojas online para você economizar de verdade.`,
      authorImage: null,
      logoText: defaultAuthor.toUpperCase(),
      themeColor: 'red',
      headline: 'RECEBA OFERTAS SECRETAS, BUGS DE PREÇO E CUPONS REAIS',
      subheadline: `Pare de pagar caro! Acompanhe em tempo real nosso radar garimpando descontos históricos e cupons imperdíveis.`,
      ctaButtonText: 'QUERO ENTRAR NOS GRUPOS VIP',
      stat1Value: '+10K',
      stat1Label: 'Membros VIP',
      stat2Value: 'R$ 500K+',
      stat2Label: 'Economia Gerada',
      stat3Value: '100%',
      stat3Label: 'Links Verificados',
      stat4Value: '24/7',
      stat4Label: 'Radar Ativo',
      youtubeUrl: null,
      instagramUrl: null,
      telegramUrl: null,
      showBenefits: true,
      showAuthority: true,
      showCategories: true,
      showFaq: true,
      createdAt: null,
      updatedAt: null,
    };

    return reply.send({
      ok: true,
      data: defaults,
    });
  });

  // PUT /affiliate-landing - Salva configurações da LP do tenant
  app.put('/affiliate-landing', { preHandler: [requireAuth] }, async (req, reply) => {
    const tenantId = req.tenantId;
    const body = affiliateLandingUpdateSchema.parse(req.body);

    // Checa se o slug já está em uso por outro tenant
    const conflict = await prisma.affiliateLandingPage.findFirst({
      where: {
        slug: body.slug,
        tenantId: { not: tenantId },
      },
    });

    if (conflict) {
      throw ApiError.conflict('Este slug de URL já está em uso por outro afiliado. Por favor, escolha outro.');
    }

    const payload = {
      slug: body.slug,
      enabled: body.enabled,
      title: body.title ?? null,
      authorName: body.authorName,
      authorBadge: body.authorBadge ?? null,
      authorBio: body.authorBio ?? null,
      authorImage: body.authorImage ?? null,
      logoText: body.logoText ?? null,
      themeColor: body.themeColor,
      headline: body.headline ?? null,
      subheadline: body.subheadline ?? null,
      ctaButtonText: body.ctaButtonText ?? null,
      stat1Value: body.stat1Value ?? null,
      stat1Label: body.stat1Label ?? null,
      stat2Value: body.stat2Value ?? null,
      stat2Label: body.stat2Label ?? null,
      stat3Value: body.stat3Value ?? null,
      stat3Label: body.stat3Label ?? null,
      stat4Value: body.stat4Value ?? null,
      stat4Label: body.stat4Label ?? null,
      youtubeUrl: body.youtubeUrl ?? null,
      instagramUrl: body.instagramUrl ?? null,
      telegramUrl: body.telegramUrl ?? null,
      showBenefits: body.showBenefits,
      showAuthority: body.showAuthority,
      showCategories: body.showCategories,
      showFaq: body.showFaq,
    };

    const saved = await prisma.affiliateLandingPage.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...payload,
      },
      update: {
        ...payload,
      },
    });

    return reply.send({
      ok: true,
      data: saved,
    });
  });
}
