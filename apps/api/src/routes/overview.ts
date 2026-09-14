import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../plugins/auth';
import { getSettings } from '../lib/settings';

export async function overviewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/overview', async (req) => {
    const [wa, shopee, queueCount, settings, batches, errors] = await Promise.all([
      req.db.waSession.findMany({ select: { id: true, label: true, status: true, phone: true } }),
      req.db.marketplaceConnection.findFirst({
        where: { kind: 'SHOPEE' },
        select: { status: true },
      }),
      req.db.queueItem.count(),
      getSettings(req.db),
      req.db.batch.findMany({
        where: { status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED'] } },
        orderBy: { createdAt: 'desc' },
        include: { items: { select: { status: true } } },
      }),
      req.db.sendLog.findMany({
        where: { status: 'ERROR' },
        orderBy: { sentAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      wa,
      shopee: shopee?.status ?? 'UNCONFIGURED',
      queue: { count: queueCount, limit: settings.queueLimit },
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        estimatedEndAt: b.estimatedEndAt,
        total: b.items.length,
        sent: b.items.filter((i) => i.status === 'SENT').length,
      })),
      errors,
    };
  });
}
