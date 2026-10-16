import type { FastifyInstance } from 'fastify';
import { resolveConnection } from '@afilados/db';
import { requireAuth } from '../plugins/auth';

export async function overviewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/overview', async (req) => {
    const [wa, shopee, queueCount, batches, errors] = await Promise.all([
      req.db.waSession.findMany({ select: { id: true, label: true, status: true, phone: true } }),
      resolveConnection(req.tenantId, 'SHOPEE'),
      req.db.queueItem.count(),
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
      shopee: shopee.row?.status ?? 'UNCONFIGURED',
      queue: { count: queueCount },
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
