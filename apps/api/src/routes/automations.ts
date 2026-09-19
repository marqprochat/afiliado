import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiError,
  automationRuleCreateSchema,
  automationRuleUpdateSchema,
  automationQueueLinkSchema,
  automationQueueCouponSchema,
} from '@afilados/shared';
import { parseProductUrl } from '@afilados/core';
import { getTagAdapter } from '@afilados/marketplaces';
import { requireAuth } from '../plugins/auth';
import { getAutomationStats } from '../lib/automations';
import { getShopeeAdapter, loadShopeeCredentials } from '../lib/marketplaces';
import { toApiProduct, upsertProducts } from '../lib/products';

const idParam = z.object({ id: z.string().min(1) });
const queueItemParam = z.object({ id: z.string().min(1), itemId: z.string().min(1) });
const toggleSchema = z.object({ enabled: z.boolean() });

async function assertRuleTargets(
  req: FastifyRequest,
  body: {
    sessionId: string;
    groupJids: string[];
    telegramChatIds?: string[];
    templateId: string;
  },
) {
  const session = await req.db.waSession.findFirst({ where: { id: body.sessionId } });
  if (!session) throw ApiError.notFound('Sessão não encontrada');
  const groups = await req.db.waGroup.findMany({
    where: { sessionId: session.id, jid: { in: body.groupJids } },
    select: { jid: true },
  });
  const known = new Set(groups.map((g) => g.jid));
  const unknown = body.groupJids.filter((j) => !known.has(j));
  if (unknown.length) throw ApiError.validation(`Grupos desconhecidos: ${unknown.join(', ')}`);
  if (body.telegramChatIds?.length) {
    const chats = await req.db.telegramChat.findMany({
      where: { chatId: { in: body.telegramChatIds } },
      select: { chatId: true },
    });
    const knownChats = new Set(chats.map((c) => c.chatId));
    const unknownChats = body.telegramChatIds.filter((c) => !knownChats.has(c));
    if (unknownChats.length) {
      throw ApiError.validation(`Chats do Telegram desconhecidos: ${unknownChats.join(', ')}`);
    }
  }
  const template = await req.db.template.findFirst({ where: { id: body.templateId } });
  if (!template) throw ApiError.notFound('Template não encontrado');
}

export async function automationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/automations', async (req) => {
    const rules = await req.db.automationRule.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(
      rules.map(async (r) => ({ ...r, stats: await getAutomationStats(req.db, r.id) })),
    );
  });

  app.post('/automations', async (req, reply) => {
    const body = automationRuleCreateSchema.parse(req.body);
    await assertRuleTargets(req, body);
    const rule = await req.db.automationRule.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: body,
    });
    return reply.status(201).send(rule);
  });

  app.patch('/automations/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const existing = await req.db.automationRule.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Regra não encontrada');
    const body = automationRuleUpdateSchema.parse(req.body);
    if (body.sessionId || body.groupJids || body.telegramChatIds || body.templateId) {
      await assertRuleTargets(req, {
        sessionId: body.sessionId ?? existing.sessionId,
        groupJids: body.groupJids ?? existing.groupJids,
        telegramChatIds: body.telegramChatIds ?? existing.telegramChatIds,
        templateId: body.templateId ?? existing.templateId,
      });
    }
    await req.db.automationRule.updateMany({
      where: { id },
      // @ts-expect-error exactOptionalPropertyTypes: campos opcionais do zod carregam `undefined`
      // explícito, que o tipo de update do Prisma não aceita (só aceita a ausência da chave).
      data: body,
    });
    await app.events.publish(req.tenantId, { type: 'automation.rules.changed' });
    return req.db.automationRule.findFirstOrThrow({ where: { id } });
  });

  app.post('/automations/:id/toggle', async (req) => {
    const { id } = idParam.parse(req.params);
    const existing = await req.db.automationRule.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Regra não encontrada');
    const { enabled } = toggleSchema.parse(req.body);
    await req.db.automationRule.updateMany({ where: { id }, data: { enabled } });
    await app.events.publish(req.tenantId, { type: 'automation.rules.changed' });
    return req.db.automationRule.findFirstOrThrow({ where: { id } });
  });

  app.delete('/automations/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await req.db.automationRule.deleteMany({ where: { id } });
    if (r.count === 0) throw ApiError.notFound('Regra não encontrada');
    await app.events.publish(req.tenantId, { type: 'automation.rules.changed' });
    return reply.status(204).send();
  });

  app.get('/automations/:id/logs', async (req) => {
    const { id } = idParam.parse(req.params);
    return req.db.automationLog.findMany({
      where: { ruleId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/automations/:id/queue', async (req) => {
    const { id } = idParam.parse(req.params);
    const items = await req.db.automationQueueItem.findMany({
      where: { ruleId: id, status: 'PENDING' },
      orderBy: [{ manual: 'desc' }, { addedAt: 'asc' }],
      include: { product: true, coupon: true },
    });
    return items.map((i) => ({ ...i, product: i.product ? toApiProduct(i.product) : null }));
  });

  app.delete('/automations/:id/queue/:itemId', async (req, reply) => {
    const { itemId } = queueItemParam.parse(req.params);
    const r = await req.db.automationQueueItem.updateMany({
      where: { id: itemId },
      data: { status: 'REMOVED' },
    });
    if (r.count === 0) throw ApiError.notFound('Item não encontrado');
    return reply.status(204).send();
  });

  app.post('/automations/:id/queue/link', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { url } = automationQueueLinkSchema.parse(req.body);
    const parsed = parseProductUrl(url);
    if (parsed.source === 'UNSUPPORTED') throw ApiError.validation(parsed.reason);
    const rule = await req.db.automationRule.findFirst({ where: { id } });
    if (!rule) throw ApiError.notFound('Regra não encontrada');

    let found;
    if (parsed.source === 'SHOPEE') {
      const { creds } = await loadShopeeCredentials(req.db);
      [found] = await getShopeeAdapter().fetchByUrls(creds, [url]);
    } else {
      [found] = await getTagAdapter(parsed.source).fetchByUrls({}, [url]);
    }
    if (!found) throw new ApiError('MARKETPLACE_ERROR', 'Não foi possível resolver a URL', 502);
    const [product] = await upsertProducts(req.db, req.tenantId, [found]);

    const item = await req.db.automationQueueItem.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: { ruleId: id, kind: 'PRODUCT', productId: product!.id, manual: true },
    });
    await app.events.publish(req.tenantId, { type: 'automation.queue.updated', ruleId: id });
    return reply.status(201).send(item);
  });

  app.post('/automations/:id/queue/coupon', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = automationQueueCouponSchema.parse(req.body);
    const rule = await req.db.automationRule.findFirst({ where: { id } });
    if (!rule) throw ApiError.notFound('Regra não encontrada');

    const tpl = await req.db.template.findFirst({ where: { id: body.templateId } });
    if (!tpl) throw ApiError.notFound('Template não encontrado');

    let couponId = body.couponId;
    if (couponId) {
      const coupon = await req.db.coupon.findFirst({ where: { id: couponId } });
      if (!coupon) throw ApiError.notFound('Cupom não encontrado');
    } else if (body.coupon) {
      const coupon = await req.db.coupon.create({
        // @ts-expect-error tenantId é injetado pela extensão forTenant
        data: {
          store: body.coupon.store,
          code: body.coupon.code,
          description: body.coupon.description,
          expiresAt: body.coupon.expiresAt ? new Date(body.coupon.expiresAt) : null,
          sourceUrl: body.coupon.sourceUrl,
        },
      });
      couponId = coupon.id;
    }

    const item = await req.db.automationQueueItem.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: { ruleId: id, kind: 'COUPON', couponId, templateId: body.templateId, manual: true },
    });
    await app.events.publish(req.tenantId, { type: 'automation.queue.updated', ruleId: id });
    return reply.status(201).send(item);
  });
}
