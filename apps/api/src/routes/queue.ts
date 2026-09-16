import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, queueAddSchema, queueSelectSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getSettings } from '../lib/settings';
import { toApiProduct } from '../lib/products';

const idParam = z.object({ id: z.string().min(1) });

function isPendingEnrich(raw: unknown): boolean {
  return Boolean(
    raw && typeof raw === 'object' && (raw as { pendingEnrich?: boolean }).pendingEnrich,
  );
}
const statusQuery = z.object({ status: z.enum(['SENT', 'ERROR']).optional() });

export async function queueRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/queue', async (req) => {
    const [items, settings] = await Promise.all([
      req.db.queueItem.findMany({ include: { product: true }, orderBy: { addedAt: 'asc' } }),
      getSettings(req.db),
    ]);
    return {
      items: items.map((i) => ({ ...i, product: toApiProduct(i.product) })),
      limit: settings.queueLimit,
      count: items.length,
    };
  });

  app.post('/queue', async (req, reply) => {
    const { productIds } = queueAddSchema.parse(req.body);
    const [settings, count, existing, products] = await Promise.all([
      getSettings(req.db),
      req.db.queueItem.count(),
      req.db.queueItem.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true },
      }),
      req.db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, raw: true },
      }),
    ]);
    const have = new Set(existing.map((e) => e.productId));
    const validRows = products.filter((p) => !have.has(p.id));
    const valid = validRows.map((p) => p.id);
    if (count + valid.length > settings.queueLimit) {
      throw new ApiError('QUEUE_FULL', `Fila cheia (${count}/${settings.queueLimit})`, 400);
    }
    if (valid.length) {
      await req.db.queueItem.createMany({
        // @ts-expect-error tenantId é injetado pela extensão forTenant
        data: validRows.map((p) => ({
          productId: p.id,
          // produto ainda sendo enriquecido em background não pode ser enviado
          status: isPendingEnrich(p.raw) ? 'PENDING_ENRICH' : 'PENDING',
        })),
      });
    }
    return reply.status(201).send({ added: valid.length, count: count + valid.length });
  });

  app.post('/queue/select', async (req) => {
    const { ids, selected } = queueSelectSchema.parse(req.body);
    const r = await req.db.queueItem.updateMany({ where: { id: { in: ids } }, data: { selected } });
    return { updated: r.count };
  });

  app.delete('/queue/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await req.db.queueItem.deleteMany({ where: { id } });
    if (r.count === 0) throw ApiError.notFound('Item não encontrado');
    return reply.status(204).send();
  });

  app.delete('/queue', async (req) => {
    const { status } = statusQuery.parse(req.query);
    const r = await req.db.queueItem.deleteMany({ where: status ? { status } : {} });
    return { removed: r.count };
  });
}
