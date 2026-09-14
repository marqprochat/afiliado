import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiError,
  QUEUE_WA_COMMANDS,
  waConnectSchema,
  waSessionCreateSchema,
  type WaCommand,
  type WaCommandJob,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getQueue } from '../lib/redis';

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
}
