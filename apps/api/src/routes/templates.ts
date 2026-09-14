import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderTemplate } from '@afilados/core';
import { ApiError, templatePreviewSchema, templateSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { SAMPLE_PRODUCT } from '../lib/batches';

const idParam = z.object({ id: z.string().min(1) });

export async function templatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/templates', async (req) => req.db.template.findMany({ orderBy: { createdAt: 'asc' } }));

  app.post('/templates', async (req, reply) => {
    const body = templateSchema.parse(req.body);
    if (body.isDefault) await req.db.template.updateMany({ where: {}, data: { isDefault: false } });
    const t = await req.db.template.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: { name: body.name, body: body.body, isDefault: body.isDefault ?? false },
    });
    return reply.status(201).send(t);
  });

  app.put('/templates/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = templateSchema.parse(req.body);
    const existing = await req.db.template.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Template não encontrado');
    if (body.isDefault) await req.db.template.updateMany({ where: {}, data: { isDefault: false } });
    await req.db.template.updateMany({
      where: { id },
      data: { name: body.name, body: body.body, isDefault: body.isDefault ?? existing.isDefault },
    });
    return req.db.template.findFirst({ where: { id } });
  });

  app.delete('/templates/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [count, inUse] = await Promise.all([
      req.db.template.count(),
      req.db.batch.count({ where: { templateId: id } }),
    ]);
    if (count <= 1) throw ApiError.validation('Não é possível remover o único template');
    if (inUse > 0) throw ApiError.validation('Template em uso por lotes');
    const r = await req.db.template.deleteMany({ where: { id } });
    if (r.count === 0) throw ApiError.notFound('Template não encontrado');
    return reply.status(204).send();
  });

  app.post('/templates/preview', async (req) => {
    const { body } = templatePreviewSchema.parse(req.body);
    return {
      text: renderTemplate(body, SAMPLE_PRODUCT, {
        affiliateLink: 'https://s.shopee.com.br/exemplo',
        now: new Date().toISOString(),
      }),
    };
  });
}
