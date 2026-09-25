import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiError,
  QUEUE_WA_COMMANDS,
  groupCreateSchema,
  groupInviteSchema,
  groupParticipantsSchema,
  groupSettingsSchema,
  waConnectSchema,
  waSessionCreateSchema,
  type WaCommand,
  type WaCommandJob,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getQueue } from '../lib/redis';

const jidParam = z.object({ id: z.string().min(1), jid: z.string().min(1) });

const idParam = z.object({ id: z.string().min(1) });
const PUBLIC_FIELDS = {
  id: true,
  label: true,
  phone: true,
  status: true,
  lastQr: true,
  pairCode: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

async function findSession(req: FastifyRequest) {
  const { id } = idParam.parse(req.params);
  const s = await req.db.waSession.findFirst({ where: { id }, select: PUBLIC_FIELDS });
  if (!s) throw ApiError.notFound('Sessão não encontrada');
  return s;
}

async function enqueue(job: WaCommandJob) {
  await getQueue<WaCommandJob>(QUEUE_WA_COMMANDS).add(job.command, job, {
    jobId: `${job.sessionId}:${job.command}:${Date.now()}`,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function waRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/wa/sessions', async (req) =>
    req.db.waSession.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } }),
  );

  app.post('/wa/sessions', async (req, reply) => {
    const body = waSessionCreateSchema.parse(req.body);
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    const s = await req.db.waSession.create({ data: { label: body.label }, select: PUBLIC_FIELDS });
    return reply.status(201).send(s);
  });

  app.delete('/wa/sessions/:id', async (req, reply) => {
    const s = await findSession(req);
    const inUse = await req.db.batch.count({ where: { sessionId: s.id } });
    if (inUse > 0) {
      throw new ApiError(
        'VALIDATION',
        `Sessão possui ${inUse} lote(s) vinculado(s). Exclua-os em Enviar Oferta antes de remover a sessão.`,
        409,
      );
    }
    if (s.status !== 'DISCONNECTED' && s.status !== 'LOGGED_OUT') {
      await enqueue({ tenantId: req.tenantId, sessionId: s.id, command: 'logout' });
    }
    await req.db.waSession.deleteMany({ where: { id: s.id } });
    return reply.status(204).send();
  });

  app.post('/wa/sessions/:id/connect', async (req, reply) => {
    const s = await findSession(req);
    const body = waConnectSchema.parse(req.body);
    await req.db.waSession.updateMany({
      where: { id: s.id },
      data: { status: 'CONNECTING', lastQr: null, pairCode: null },
    });
    const job: WaCommandJob = {
      tenantId: req.tenantId,
      sessionId: s.id,
      command: 'connect',
      mode: body.mode,
    };
    if (body.phone) job.phone = body.phone;
    await enqueue(job);
    return reply.status(202).send({ queued: true });
  });

  for (const command of ['disconnect', 'logout', 'sync-groups'] as WaCommand[]) {
    app.post(`/wa/sessions/:id/${command}`, async (req, reply) => {
      const s = await findSession(req);
      await enqueue({ tenantId: req.tenantId, sessionId: s.id, command });
      return reply.status(202).send({ queued: true });
    });
  }

  app.get('/wa/sessions/:id/groups', async (req) => {
    const s = await findSession(req);
    return req.db.waGroup.findMany({ where: { sessionId: s.id }, orderBy: { name: 'asc' } });
  });

  app.post('/wa/sessions/:id/groups', async (req, reply) => {
    const s = await findSession(req);
    const body = groupCreateSchema.parse(req.body);
    await enqueue({
      tenantId: req.tenantId,
      sessionId: s.id,
      command: 'create-group',
      groupSubject: body.subject,
      groupParticipants: body.participants,
    });
    return reply.status(202).send({ queued: true });
  });

  app.post('/wa/sessions/:id/groups/:jid/participants', async (req, reply) => {
    const s = await findSession(req);
    const { jid } = jidParam.parse(req.params);
    const body = groupParticipantsSchema.parse(req.body);
    await enqueue({
      tenantId: req.tenantId,
      sessionId: s.id,
      command: 'group-participants',
      groupJid: jid,
      participantAction: body.action,
      groupParticipants: body.participants,
    });
    return reply.status(202).send({ queued: true });
  });

  app.patch('/wa/sessions/:id/groups/:jid', async (req, reply) => {
    const s = await findSession(req);
    const { jid } = jidParam.parse(req.params);
    const body = groupSettingsSchema.parse(req.body);
    const job: WaCommandJob = {
      tenantId: req.tenantId,
      sessionId: s.id,
      command: 'group-settings',
      groupJid: jid,
    };
    if (body.subject !== undefined) job.subject = body.subject;
    if (body.description !== undefined) job.description = body.description;
    if (body.announceOnly !== undefined) job.announceOnly = body.announceOnly;
    await enqueue(job);
    return reply.status(202).send({ queued: true });
  });

  app.post('/wa/sessions/:id/groups/:jid/invite', async (req, reply) => {
    const s = await findSession(req);
    const { jid } = jidParam.parse(req.params);
    const body = groupInviteSchema.parse(req.body ?? {});
    await enqueue({
      tenantId: req.tenantId,
      sessionId: s.id,
      command: 'group-invite',
      groupJid: jid,
      revokeInvite: body.revoke,
    });
    return reply.status(202).send({ queued: true });
  });

  app.post('/wa/sessions/:id/groups/:jid/details', async (req, reply) => {
    const s = await findSession(req);
    const { jid } = jidParam.parse(req.params);
    await enqueue({
      tenantId: req.tenantId,
      sessionId: s.id,
      command: 'group-details',
      groupJid: jid,
    });
    return reply.status(202).send({ queued: true });
  });
}
