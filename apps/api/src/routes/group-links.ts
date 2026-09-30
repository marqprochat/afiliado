import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afilados/db';
import {
  ApiError,
  QUEUE_GROUP_LINK_ROTATE,
  buildGroupName,
  groupLinkCreateSchema,
  groupLinkRotateSchema,
  groupLinkUpdateSchema,
  isValidSlug,
  type GroupLinkRotateJob,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getQueue, getRedis } from '../lib/redis';

const idParam = z.object({ id: z.string().min(1) });
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
      orderBy: { createdAt: 'desc' },
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
        seedParticipants: body.seedParticipants,
        groupImageBase64: body.groupImageBase64 || null,
        fallbackUrl: body.fallbackUrl || null,
        enabled: true,
        status: 'ACTIVE',
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
        ...(body.seedParticipants !== undefined ? { seedParticipants: body.seedParticipants } : {}),
        ...(body.groupImageBase64 !== undefined
          ? { groupImageBase64: body.groupImageBase64 || null }
          : {}),
        ...(body.fallbackUrl !== undefined ? { fallbackUrl: body.fallbackUrl } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });

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
