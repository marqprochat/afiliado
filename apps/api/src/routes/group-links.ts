import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afilados/db';
import {
  ApiError,
  GROUP_LINK_SYNC_FIELDS,
  QUEUE_GROUP_LINK_ROTATE,
  QUEUE_GROUP_LINK_SYNC,
  buildGroupName,
  groupLinkCreateSchema,
  groupLinkPointSchema,
  groupLinkReorderSchema,
  groupLinkRotateSchema,
  groupLinkUpdateSchema,
  isValidSlug,
  type GroupLinkRotateJob,
  type GroupLinkSyncJob,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getQueue, getRedis } from '../lib/redis';

const idParam = z.object({ id: z.string().min(1) });

async function enqueueGroupLinkSync(tenantId: string, groupLinkId: string, fields?: string[]) {
  const queue = getQueue<GroupLinkSyncJob>(QUEUE_GROUP_LINK_SYNC);
  await queue.add(
    'sync',
    { tenantId, groupLinkId, ...(fields ? { fields } : {}) },
    { attempts: 3, backoff: { type: 'exponential', delay: 15_000 } },
  );
}
const slugQuery = z.object({ slug: z.string().min(1) });

export async function groupLinksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Validação de disponibilidade de slug
  app.get('/group-links/slug-available', async (req) => {
    const { slug } = slugQuery.parse(req.query);
    const normalized = slug.trim().toLowerCase();

    if (!isValidSlug(normalized)) {
      return {
        available: false,
        reason:
          'Slug inválido (deve ter 3-40 caracteres minúsculos, números e hífens, sem palavras reservadas)',
      };
    }

    const existing = await prisma.groupLink.findUnique({
      where: { slug: normalized },
    });

    if (existing) {
      return { available: false, reason: 'Slug já está em uso' };
    }

    return { available: true };
  });

  // Lista todos os links fixos do tenant
  app.get('/group-links', async (req) => {
    const links = await req.db.groupLink.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        session: { select: { id: true, label: true, phone: true, status: true } },
        groups: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
        _count: {
          select: { groups: true },
        },
      },
    });
    return links;
  });

  // Reordena a lista de links fixos (ordem de exibição na landing page)
  app.patch('/group-links/reorder', async (req, reply) => {
    const { orderedIds } = groupLinkReorderSchema.parse(req.body);

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.groupLink.updateMany({
          where: { id, tenantId: req.tenantId },
          data: { displayOrder: index },
        }),
      ),
    );

    await req.server.events.publish(req.tenantId, {
      type: 'group-links.changed',
      tenantId: req.tenantId,
    });

    return reply.send({ ok: true });
  });

  // Cria um novo link fixo
  app.post('/group-links', async (req, reply) => {
    const body = groupLinkCreateSchema.parse(req.body);

    const existing = await prisma.groupLink.findUnique({
      where: { slug: body.slug },
    });
    if (existing) {
      throw new ApiError('VALIDATION', 'Este slug já está em uso', 409);
    }

    const session = await req.db.waSession.findFirst({
      where: { id: body.sessionId },
    });
    if (!session) {
      throw ApiError.notFound('Sessão do WhatsApp não encontrada');
    }

    const maxOrder = await req.db.groupLink.aggregate({
      _max: { displayOrder: true },
    });
    const nextOrder = (maxOrder._max.displayOrder ?? -1) + 1;

    const link = await req.db.groupLink.create({
      data: {
        tenantId: req.tenantId,
        sessionId: body.sessionId,
        slug: body.slug,
        label: body.label,
        baseName: body.baseName,
        customText: body.customText ?? '',
        textPosition: body.textPosition,
        numberPrefix: body.numberPrefix,
        startNumber: body.startNumber,
        nextSequence: 1,
        memberLimit: body.memberLimit,
        rotateMargin: body.rotateMargin,
        maxRotationsPerHour: body.maxRotationsPerHour,
        groupDescription: body.groupDescription ?? null,
        announceOnly: body.announceOnly,
        restrictEditInfo: body.restrictEditInfo,
        restrictAddMembers: body.restrictAddMembers,
        joinApproval: body.joinApproval,
        seedParticipants: body.seedParticipants,
        groupImageBase64: body.groupImageBase64 || null,
        fallbackUrl: body.fallbackUrl || null,
        enabled: true,
        status: 'ACTIVE',
        displayOrder: nextOrder,
      },
    });

    if (body.initialGroupJid) {
      // Adota grupo existente
      const waGroup = await req.db.waGroup.findFirst({
        where: { sessionId: body.sessionId, jid: body.initialGroupJid },
      });

      const initialName =
        waGroup?.name ??
        buildGroupName({
          baseName: body.baseName,
          customText: body.customText,
          textPosition: body.textPosition,
          numberPrefix: body.numberPrefix,
          number: body.startNumber,
        });

      await req.db.managedGroup.create({
        data: {
          tenantId: req.tenantId,
          groupLinkId: link.id,
          sequence: 1,
          number: body.startNumber,
          jid: body.initialGroupJid,
          name: initialName,
          inviteLink: waGroup?.inviteLink ?? null,
          memberCount: waGroup?.memberCount ?? 0,
          status: 'ACTIVE',
          activatedAt: new Date(),
          countSyncedAt: new Date(),
          inviteSyncedAt: waGroup?.inviteLink ? new Date() : null,
        },
      });

      await req.db.groupLink.updateMany({
        where: { id: link.id },
        data: { nextSequence: 2 },
      });
      // Grupo adotado recebe descrição, foto e restrições do link (mantém o nome original).
      await enqueueGroupLinkSync(
        req.tenantId,
        link.id,
        GROUP_LINK_SYNC_FIELDS.filter(
          (f) => !['baseName', 'customText', 'textPosition', 'numberPrefix'].includes(f),
        ),
      );
    } else {
      // Enfileira criação inicial do primeiro grupo
      const queue = getQueue<GroupLinkRotateJob>(QUEUE_GROUP_LINK_ROTATE);
      await queue.add(
        'rotate',
        {
          tenantId: req.tenantId,
          groupLinkId: link.id,
          fromGroupId: null,
          reason: 'initial',
        },
        {
          jobId: `rotate-${link.id}-1`.replace(/:/g, '-'),
          attempts: 5,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      );
    }

    await req.server.events.publish(req.tenantId, {
      type: 'group-links.changed',
      tenantId: req.tenantId,
    });

    return reply.status(201).send(link);
  });

  // Busca detalhes de um link fixo
  app.get('/group-links/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const link = await req.db.groupLink.findFirst({
      where: { id },
      include: {
        session: { select: { id: true, label: true, phone: true, status: true } },
        groups: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
      },
    });
    if (!link) throw ApiError.notFound('Link não encontrado');
    return link;
  });

  // Histórico de grupos de um link fixo
  app.get('/group-links/:id/groups', async (req) => {
    const { id } = idParam.parse(req.params);
    const link = await req.db.groupLink.findFirst({ where: { id } });
    if (!link) throw ApiError.notFound('Link não encontrado');

    const groups = await req.db.managedGroup.findMany({
      where: { groupLinkId: id },
      orderBy: { sequence: 'desc' },
    });
    return groups;
  });

  // Atualiza configurações de um link fixo
  app.patch('/group-links/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const link = await req.db.groupLink.findFirst({ where: { id } });
    if (!link) throw ApiError.notFound('Link não encontrado');

    const body = groupLinkUpdateSchema.parse(req.body);

    await req.db.groupLink.updateMany({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.baseName !== undefined ? { baseName: body.baseName } : {}),
        ...(body.customText !== undefined ? { customText: body.customText } : {}),
        ...(body.textPosition !== undefined ? { textPosition: body.textPosition } : {}),
        ...(body.numberPrefix !== undefined ? { numberPrefix: body.numberPrefix } : {}),
        ...(body.memberLimit !== undefined ? { memberLimit: body.memberLimit } : {}),
        ...(body.rotateMargin !== undefined ? { rotateMargin: body.rotateMargin } : {}),
        ...(body.maxRotationsPerHour !== undefined
          ? { maxRotationsPerHour: body.maxRotationsPerHour }
          : {}),
        ...(body.groupDescription !== undefined ? { groupDescription: body.groupDescription } : {}),
        ...(body.announceOnly !== undefined ? { announceOnly: body.announceOnly } : {}),
        ...(body.restrictEditInfo !== undefined ? { restrictEditInfo: body.restrictEditInfo } : {}),
        ...(body.restrictAddMembers !== undefined
          ? { restrictAddMembers: body.restrictAddMembers }
          : {}),
        ...(body.joinApproval !== undefined ? { joinApproval: body.joinApproval } : {}),
        ...(body.seedParticipants !== undefined ? { seedParticipants: body.seedParticipants } : {}),
        ...(body.groupImageBase64 !== undefined
          ? { groupImageBase64: body.groupImageBase64 || null }
          : {}),
        ...(body.fallbackUrl !== undefined ? { fallbackUrl: body.fallbackUrl } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder } : {}),
      },
    });

    // Propaga para todos os grupos já criados apenas o que de fato mudou.
    const normalized: Record<string, unknown> = {
      ...body,
      ...(body.groupImageBase64 !== undefined
        ? { groupImageBase64: body.groupImageBase64 || null }
        : {}),
    };
    const changed = GROUP_LINK_SYNC_FIELDS.filter(
      (f) => normalized[f] !== undefined && normalized[f] !== (link as Record<string, unknown>)[f],
    );
    if (changed.length > 0) await enqueueGroupLinkSync(req.tenantId, id, [...changed]);

    await getRedis().del(`grouplink:slug:${link.slug}`);
    await req.server.events.publish(req.tenantId, {
      type: 'group-link.updated',
      groupLinkId: id,
    });
    await req.server.events.publish(req.tenantId, {
      type: 'group-links.changed',
      tenantId: req.tenantId,
    });

    const updated = await req.db.groupLink.findFirst({
      where: { id },
      include: {
        session: { select: { id: true, label: true, phone: true, status: true } },
        groups: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
      },
    });
    return updated;
  });

  // Deleta um link fixo
  app.delete('/group-links/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const link = await req.db.groupLink.findFirst({ where: { id } });
    if (!link) throw ApiError.notFound('Link não encontrado');

    await req.db.groupLink.deleteMany({ where: { id } });
    await getRedis().del(`grouplink:slug:${link.slug}`);

    await req.server.events.publish(req.tenantId, {
      type: 'group-links.changed',
      tenantId: req.tenantId,
    });

    return reply.status(204).send();
  });

  // Força rotação manual do grupo
  app.post('/group-links/:id/rotate', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const link = await req.db.groupLink.findFirst({
      where: { id },
      include: { groups: { where: { status: 'ACTIVE' } } },
    });
    if (!link) throw ApiError.notFound('Link não encontrado');

    const body = groupLinkRotateSchema.parse(req.body ?? {});
    const currentActive = link.groups[0] ?? null;

    const queue = getQueue<GroupLinkRotateJob>(QUEUE_GROUP_LINK_ROTATE);
    await queue.add(
      'rotate',
      {
        tenantId: req.tenantId,
        groupLinkId: link.id,
        fromGroupId: currentActive?.id ?? null,
        reason: body.reason,
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );

    return reply.status(202).send({ queued: true });
  });

  // Reaplica nome, descrição, foto e restrições em todos os grupos do link
  app.post('/group-links/:id/sync', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const link = await req.db.groupLink.findFirst({ where: { id } });
    if (!link) throw ApiError.notFound('Link não encontrado');
    await enqueueGroupLinkSync(req.tenantId, id);
    return reply.status(202).send({ queued: true });
  });

  // Aponta o link para um grupo específico já criado (ex.: voltar para o #1 que ainda não lotou).
  // O grupo ativo atual fica em espera (STANDBY) e será reaproveitado na próxima rotação.
  app.post('/group-links/:id/point', async (req) => {
    const { id } = idParam.parse(req.params);
    const { groupId } = groupLinkPointSchema.parse(req.body);
    const link = await req.db.groupLink.findFirst({ where: { id } });
    if (!link) throw ApiError.notFound('Link não encontrado');

    const target = await req.db.managedGroup.findFirst({ where: { id: groupId, groupLinkId: id } });
    if (!target) throw ApiError.notFound('Grupo não encontrado neste link');
    if (target.status === 'ACTIVE') return { ok: true, unchanged: true };
    // ORPHANED é permitido: a marcação pode ter vindo de uma falha transitória (ex.: timeout).
    // Se o grupo realmente sumiu, a próxima reconciliação o marca de novo e rotaciona.
    if (!target.jid || target.status === 'CREATING') {
      throw new ApiError('VALIDATION', 'Este grupo não está disponível no WhatsApp', 409);
    }
    const rotateAt = Math.max(1, link.memberLimit - link.rotateMargin);
    if (target.memberCount >= rotateAt) {
      throw new ApiError(
        'VALIDATION',
        `Este grupo já tem ${target.memberCount} membros (troca em ${rotateAt}); escolha outro ou aumente o limite`,
        409,
      );
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const current = await tx.managedGroup.findMany({
        where: { groupLinkId: id, status: 'ACTIVE' },
      });
      for (const g of current) {
        await tx.managedGroup.updateMany({
          where: { id: g.id },
          data:
            g.memberCount >= rotateAt
              ? { status: 'FULL', filledAt: g.filledAt ?? now }
              : { status: 'STANDBY' },
        });
      }
      await tx.managedGroup.updateMany({
        where: { id: target.id },
        data: { status: 'ACTIVE', activatedAt: now, filledAt: null, lastError: null },
      });
      await tx.groupLink.updateMany({
        where: { id, tenantId: req.tenantId },
        data: { lastRotatedAt: now, lastError: null },
      });
    });

    await getRedis().del(`grouplink:slug:${link.slug}`);
    await req.server.events.publish(req.tenantId, {
      type: 'group-link.rotated',
      groupLinkId: id,
      newGroupId: target.id,
      sequence: target.sequence,
    });
    await req.server.events.publish(req.tenantId, {
      type: 'group-links.changed',
      tenantId: req.tenantId,
    });
    return { ok: true };
  });

  // Dispara reconciliação imediata do grupo ativo
  app.post('/group-links/:id/reconcile', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const link = await req.db.groupLink.findFirst({ where: { id } });
    if (!link) throw ApiError.notFound('Link não encontrado');

    await req.server.events.publish(req.tenantId, {
      type: 'group-links.changed',
      tenantId: req.tenantId,
    });

    return reply.status(200).send({ ok: true });
  });
}
