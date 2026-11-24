import type { FastifyInstance } from 'fastify';
import { SITE_LINKS_KEY, siteLinksEnabled, siteLinksUpdateSchema } from '@afilados/shared';
import { forbidAffiliate, requireAuth } from '../plugins/auth';

export async function siteLinksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', forbidAffiliate);

  app.get('/settings/site-links', async (req) => {
    const row = await req.db.setting.findFirst({ where: { key: SITE_LINKS_KEY } });
    return { enabled: siteLinksEnabled(row?.value) };
  });

  app.put('/settings/site-links', async (req) => {
    const body = siteLinksUpdateSchema.parse(req.body);
    await req.db.setting.upsert({
      where: { tenantId_key: { tenantId: req.tenantId, key: SITE_LINKS_KEY } },
      update: { value: body },
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      create: { key: SITE_LINKS_KEY, value: body },
    });
    return { enabled: body.enabled };
  });
}
