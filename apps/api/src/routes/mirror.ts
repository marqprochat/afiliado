import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, mirrorLogsQuerySchema, mirrorRuleSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';

const idParam = z.object({ id: z.string().min(1) });

export async function mirrorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/mirror/rules', async (req) => {
    const rules = await req.db.mirrorRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        session: { select: { id: true, label: true, status: true } },
        template: { select: { id: true, name: true } },
      },
    });
    const since24h = new Date(Date.now() - 24 * 3600_000);
    const logCounts = await req.db.mirrorLog.groupBy({
      by: ['ruleId', 'status'],
      where: { createdAt: { gte: since24h } },
      _count: true,
    });

    const countMap = new Map<string, { mirrored: number; discarded: number; error: number }>();
    for (const c of logCounts) {
      if (!countMap.has(c.ruleId)) {
        countMap.set(c.ruleId, { mirrored: 0, discarded: 0, error: 0 });
      }
      const item = countMap.get(c.ruleId)!;
      if (c.status === 'MIRRORED') item.mirrored += c._count;
      else if (c.status === 'DISCARDED') item.discarded += c._count;
      else if (c.status === 'ERROR') item.error += c._count;
    }

    return rules.map((r) => ({
      ...r,
      counts: countMap.get(r.id) ?? { mirrored: 0, discarded: 0, error: 0 },
    }));
  });

  app.post('/mirror/rules', async (req, reply) => {
    const body = mirrorRuleSchema.parse(req.body);

    const session = await req.db.waSession.findFirst({ where: { id: body.sessionId } });
    if (!session) throw ApiError.notFound('Sessão do WhatsApp não encontrada');

    if (body.templateId) {
      const template = await req.db.template.findFirst({ where: { id: body.templateId } });
      if (!template) throw ApiError.notFound('Template não encontrado');
    }

    const allJids = Array.from(new Set([...body.sourceJids, ...body.targetJids]));
    const groups = await req.db.waGroup.findMany({
      where: { sessionId: body.sessionId, jid: { in: allJids } },
      select: { jid: true },
    });
    const foundJids = new Set(groups.map((g) => g.jid));
    const missing = allJids.filter((j) => !foundJids.has(j));
    if (missing.length > 0) {
      throw ApiError.validation(`Grupos não encontrados nesta sessão: ${missing.join(', ')}`);
    }

    // @ts-expect-error tenantId é injetado pelo forTenant
    const rule = await req.db.mirrorRule.create({
      data: {
        name: body.name,
        sessionId: body.sessionId,
        sourceJids: body.sourceJids,
        targetJids: body.targetJids,
        mode: body.mode,
        mediaMode: body.mediaMode,
        templateId: body.templateId ?? null,
        dedupHours: body.dedupHours,
        enabled: body.enabled,
      },
      include: {
        session: { select: { id: true, label: true, status: true } },
        template: { select: { id: true, name: true } },
      },
    });

    await app.events.publish(req.user.tenantId, { type: 'mirror.rules.changed' });
    reply.status(201);
    return {
      ...rule,
      counts: { mirrored: 0, discarded: 0, error: 0 },
    };
  });

  app.put('/mirror/rules/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const existing = await req.db.mirrorRule.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Regra não encontrada');

    const body = mirrorRuleSchema.parse(req.body);

    const session = await req.db.waSession.findFirst({ where: { id: body.sessionId } });
    if (!session) throw ApiError.notFound('Sessão do WhatsApp não encontrada');

    if (body.templateId) {
      const template = await req.db.template.findFirst({ where: { id: body.templateId } });
      if (!template) throw ApiError.notFound('Template não encontrado');
    }

    const allJids = Array.from(new Set([...body.sourceJids, ...body.targetJids]));
    const groups = await req.db.waGroup.findMany({
      where: { sessionId: body.sessionId, jid: { in: allJids } },
      select: { jid: true },
    });
    const foundJids = new Set(groups.map((g) => g.jid));
    const missing = allJids.filter((j) => !foundJids.has(j));
    if (missing.length > 0) {
      throw ApiError.validation(`Grupos não encontrados nesta sessão: ${missing.join(', ')}`);
    }

    await req.db.mirrorRule.updateMany({
      where: { id },
      data: {
        name: body.name,
        sessionId: body.sessionId,
        sourceJids: body.sourceJids,
        targetJids: body.targetJids,
        mode: body.mode,
        mediaMode: body.mediaMode,
        templateId: body.templateId ?? null,
        dedupHours: body.dedupHours,
        enabled: body.enabled,
      },
    });

    await app.events.publish(req.user.tenantId, { type: 'mirror.rules.changed' });

    const updated = await req.db.mirrorRule.findFirstOrThrow({
      where: { id },
      include: {
        session: { select: { id: true, label: true, status: true } },
        template: { select: { id: true, name: true } },
      },
    });
    return updated;
  });

  app.delete('/mirror/rules/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const existing = await req.db.mirrorRule.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Regra não encontrada');

    await req.db.mirrorRule.deleteMany({ where: { id } });
    await app.events.publish(req.user.tenantId, { type: 'mirror.rules.changed' });
    reply.status(204).send();
  });

  app.post('/mirror/rules/:id/toggle', async (req) => {
    const { id } = idParam.parse(req.params);
    const existing = await req.db.mirrorRule.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Regra não encontrada');

    const nextEnabled = !existing.enabled;
    await req.db.mirrorRule.updateMany({
      where: { id },
      data: { enabled: nextEnabled },
    });

    await app.events.publish(req.user.tenantId, { type: 'mirror.rules.changed' });
    return { id, enabled: nextEnabled };
  });

  app.get('/mirror/logs', async (req) => {
    const query = mirrorLogsQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (query.ruleId) where.ruleId = query.ruleId;
    if (query.status) where.status = query.status;

    const logs = await req.db.mirrorLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: {
        rule: { select: { id: true, name: true } },
      },
    });

    const allJids = Array.from(
      new Set([...logs.map((l) => l.targetJid), ...logs.map((l) => l.sourceJid)]),
    );
    const groups = await req.db.waGroup.findMany({
      where: { jid: { in: allJids } },
      select: { jid: true, name: true },
    });
    const groupNameMap = new Map(groups.map((g) => [g.jid, g.name]));

    return logs.map((l) => ({
      ...l,
      sourceName: groupNameMap.get(l.sourceJid) ?? l.sourceJid,
      targetName: groupNameMap.get(l.targetJid) ?? l.targetJid,
    }));
  });

  app.get('/mirror/stats', async (req) => {
    const sinceToday = new Date();
    sinceToday.setHours(0, 0, 0, 0);

    const logCounts = await req.db.mirrorLog.groupBy({
      by: ['status'],
      where: { createdAt: { gte: sinceToday } },
      _count: true,
    });

    const today = { mirrored: 0, discarded: 0, error: 0 };
    for (const c of logCounts) {
      if (c.status === 'MIRRORED') today.mirrored += c._count;
      else if (c.status === 'DISCARDED') today.discarded += c._count;
      else if (c.status === 'ERROR') today.error += c._count;
    }

    return { today };
  });
}
