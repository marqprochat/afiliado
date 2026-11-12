import type { FastifyInstance } from 'fastify';
import { prisma } from '@afilados/db';
import {
  ApiError,
  affiliateLandingUpdateSchema,
  AURA_DEFAULT_NICHES,
  AURA_DEFAULT_STEPS,
  AURA_DEFAULT_FAQS,
  AURA_DEFAULT_HERO_IMAGE,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';

function generateSlugFromName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'clube-vip';
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

    // Determina os nichos que serão exibidos
    let niches = Array.isArray(lp.customNiches) && (lp.customNiches as any[]).length > 0
      ? (lp.customNiches as any[])
      : AURA_DEFAULT_NICHES.map((dn, idx) => {
          // Se o tenant tem links cadastrados, vincula a url de redirecionamento correspondente
          const matchingGroup = formattedGroups[idx] || formattedGroups[0];
          return {
            ...dn,
            whatsappLink: matchingGroup ? matchingGroup.redirectUrl : lp.whatsappGeneralUrl || '#',
          };
        });

    return reply.send({
      ok: true,
      data: {
        profile: {
          id: lp.id,
          slug: lp.slug,
          title: lp.title || `Clube de Preços VIP · ${lp.authorName}`,
          authorName: lp.authorName,
          authorBadge: lp.authorBadge || 'RADAR VIP · 24H',
          authorBio: lp.authorBio,
          authorImage: lp.authorImage,
          logoText: lp.logoText || 'CLUBE DE PREÇOS VIP',
          themeColor: lp.themeColor || 'rose',
          themeMode: lp.themeMode || 'light',
          buttonColor: lp.buttonColor || 'emerald',

          // Dobra 1: Hero
          heroImage: lp.heroImage || AURA_DEFAULT_HERO_IMAGE,
          badgeText: lp.badgeText || 'Grupos de Preços & Ofertas VIP · 100% Gratuito',
          headline: lp.headline || 'Os melhores achadinhos e cupons secretos no seu WhatsApp',
          subheadline:
            lp.subheadline ||
            'Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas. Escolha seu nicho abaixo e entre no grupo do WhatsApp!',
          floatingBadgeText: lp.floatingBadgeText || 'Garimpo Ao Vivo no WhatsApp · 4 Nichos Exclusivos',
          ctaButtonText: lp.ctaButtonText || 'Entrar no Grupo do WhatsApp',
          reassuranceText:
            lp.reassuranceText ||
            '100% Silencioso (sem conversas paralelas) · Apenas administradores postam · Gratuito para sempre',
          whatsappGeneralUrl: lp.whatsappGeneralUrl || (formattedGroups[0]?.redirectUrl ?? null),

          // Como Funciona
          howItWorksTitle: lp.howItWorksTitle || 'Como funcionam os nossos grupos de preço',
          howItWorksSubtitle:
            lp.howItWorksSubtitle ||
            'Economizar não precisa dar trabalho. Nós fazemos a busca exaustiva para você apenas aproveitar.',
          howItWorksSteps: (Array.isArray(lp.howItWorksSteps) && (lp.howItWorksSteps as any[]).length > 0)
            ? lp.howItWorksSteps
            : AURA_DEFAULT_STEPS,

          // FAQ
          faqTitle: lp.faqTitle || 'Tudo o que você precisa saber sobre os grupos',
          faqSubtitle:
            lp.faqSubtitle ||
            'Respostas diretas e transparentes para você entrar com total tranquilidade.',
          faqItems: (Array.isArray(lp.faqItems) && (lp.faqItems as any[]).length > 0)
            ? lp.faqItems
            : AURA_DEFAULT_FAQS,
          faqBannerTitle: lp.faqBannerTitle || 'Quer entrar no Grupo Geral com todos os nichos juntos?',
          faqBannerText:
            lp.faqBannerText ||
            'Se você prefere receber todos os achadinhos em um único grupo, temos o Grupo Geral VIP no WhatsApp ativo.',
          faqBannerButtonText: lp.faqBannerButtonText || 'Entrar no WhatsApp Geral',

          // Rodapé
          footerText:
            lp.footerText ||
            'A curadoria independente de promoções, cupons e achadinhos nos melhores e-commerces do Brasil.',

          // Redes Sociais
          youtubeUrl: lp.youtubeUrl,
          instagramUrl: lp.instagramUrl,
          telegramUrl: lp.telegramUrl,

          // Visibilidade de Seções
          showBenefits: lp.showBenefits,
          showAuthority: lp.showAuthority,
          showCategories: lp.showCategories,
          showFaq: lp.showFaq,
          showHowItWorks: lp.showHowItWorks,
          showNiches: lp.showNiches,
        },
        niches,
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
        data: {
          ...existing,
          howItWorksSteps: existing.howItWorksSteps || AURA_DEFAULT_STEPS,
          faqItems: existing.faqItems || AURA_DEFAULT_FAQS,
          customNiches: existing.customNiches || AURA_DEFAULT_NICHES,
          heroImage: existing.heroImage || AURA_DEFAULT_HERO_IMAGE,
        },
      });
    }

    // Se ainda não existir no banco, gera defaults inteligentes baseados no modelo Aura
    const defaultAuthor = tenant.name || user?.name || 'Clube de Preços VIP';
    const suggestedSlug = generateSlugFromName(defaultAuthor);

    const defaults = {
      id: null,
      tenantId,
      slug: suggestedSlug,
      enabled: true,
      title: `Clube de Preços VIP · ${defaultAuthor}`,
      authorName: defaultAuthor,
      authorBadge: 'RADAR VIP · 24H',
      authorBio: 'Monitoramento contínuo de preços e cupons das melhores lojas online para você economizar de verdade.',
      authorImage: null,
      logoText: 'CLUBE DE PREÇOS VIP',
      themeColor: 'rose',
      themeMode: 'light',
      buttonColor: 'emerald',

      // Dobra 1: Hero
      heroImage: AURA_DEFAULT_HERO_IMAGE,
      badgeText: 'Grupos de Preços & Ofertas VIP · 100% Gratuito',
      headline: 'Os melhores achadinhos e cupons secretos no seu WhatsApp',
      subheadline:
        'Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas. Escolha seu nicho abaixo e entre no grupo do WhatsApp!',
      floatingBadgeText: 'Garimpo Ao Vivo no WhatsApp · 4 Nichos Exclusivos',
      ctaButtonText: 'Entrar no Grupo do WhatsApp',
      reassuranceText:
        '100% Silencioso (sem conversas paralelas) · Apenas administradores postam · Gratuito para sempre',
      whatsappGeneralUrl: null,

      // Dobra Como Funciona
      howItWorksTitle: 'Como funcionam os nossos grupos de preço',
      howItWorksSubtitle:
        'Economizar não precisa dar trabalho. Nós fazemos a busca exaustiva para você apenas aproveitar.',
      howItWorksSteps: AURA_DEFAULT_STEPS,

      // Dobra FAQ
      faqTitle: 'Tudo o que você precisa saber sobre os grupos',
      faqSubtitle: 'Respostas diretas e transparentes para você entrar com total tranquilidade.',
      faqItems: AURA_DEFAULT_FAQS,
      faqBannerTitle: 'Quer entrar no Grupo Geral com todos os nichos juntos?',
      faqBannerText:
        'Se você prefere receber todos os achadinhos em um único grupo, temos o Grupo Geral VIP no WhatsApp ativo.',
      faqBannerButtonText: 'Entrar no WhatsApp Geral',

      // Nichos
      customNiches: AURA_DEFAULT_NICHES,

      // Rodapé
      footerText:
        'A curadoria independente de promoções, cupons e achadinhos nos melhores e-commerces do Brasil.',

      // Estatísticas legado
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
      showHowItWorks: true,
      showNiches: true,
      createdAt: null,
      updatedAt: null,
    };

    return reply.send({
      ok: true,
      data: defaults,
    });
  });

  // PUT /affiliate-landing - Salva configurações da LP do tenant
  app.put('/affiliate-landing', { preHandler: [requireAuth], bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
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
      themeMode: body.themeMode,
      buttonColor: body.buttonColor,

      // Dobra 1: Hero
      heroImage: body.heroImage ?? null,
      badgeText: body.badgeText ?? null,
      headline: body.headline ?? null,
      subheadline: body.subheadline ?? null,
      floatingBadgeText: body.floatingBadgeText ?? null,
      ctaButtonText: body.ctaButtonText ?? null,
      reassuranceText: body.reassuranceText ?? null,
      whatsappGeneralUrl: body.whatsappGeneralUrl ?? null,

      // Como Funciona
      howItWorksTitle: body.howItWorksTitle ?? null,
      howItWorksSubtitle: body.howItWorksSubtitle ?? null,
      howItWorksSteps: body.howItWorksSteps ? (body.howItWorksSteps as any) : undefined,

      // FAQ
      faqTitle: body.faqTitle ?? null,
      faqSubtitle: body.faqSubtitle ?? null,
      faqItems: body.faqItems ? (body.faqItems as any) : undefined,
      faqBannerTitle: body.faqBannerTitle ?? null,
      faqBannerText: body.faqBannerText ?? null,
      faqBannerButtonText: body.faqBannerButtonText ?? null,

      // Nichos
      customNiches: body.customNiches ? (body.customNiches as any) : undefined,

      // Rodapé
      footerText: body.footerText ?? null,

      // Legado
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

      // Visibilidade
      showBenefits: body.showBenefits,
      showAuthority: body.showAuthority,
      showCategories: body.showCategories,
      showFaq: body.showFaq,
      showHowItWorks: body.showHowItWorks,
      showNiches: body.showNiches,
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
