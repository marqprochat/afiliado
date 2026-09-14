import type { FastifyInstance, FastifyRequest } from 'fastify';
import { settingsUpdateSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getOperatingWindow, getSettings, setSetting, toCoreWindow } from '../lib/settings';

async function payload(req: FastifyRequest) {
  const [w, s] = await Promise.all([getOperatingWindow(req.db, req.tenantId), getSettings(req.db)]);
  return { window: toCoreWindow(w), ...s };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/settings', async (req) => payload(req));

  app.put('/settings', async (req) => {
    const body = settingsUpdateSchema.parse(req.body);
    if (body.window) {
      await getOperatingWindow(req.db, req.tenantId);
      const windowData = Object.fromEntries(
        Object.entries(body.window).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(windowData).length > 0) {
        await req.db.operatingWindow.updateMany({
          where: { tenantId: req.tenantId },
          data: windowData,
        });
      }
    }
    for (const key of ['queueLimit', 'globalRateLimitPerMin', 'subIdPattern'] as const) {
      if (body[key] !== undefined) await setSetting(req.db, req.tenantId, key, body[key]);
    }
    return payload(req);
  });
}
