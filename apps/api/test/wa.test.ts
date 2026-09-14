import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QUEUE_WA_COMMANDS, type WaCommandJob } from '@afilados/shared';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
beforeAll(async () => {
  t = await createTenantWithUser();
  other = await createTenantWithUser('o');
  cookie = await loginCookie(app, t.email, t.password);
  await getQueue(QUEUE_WA_COMMANDS).drain();
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

describe('wa sessions', () => {
  let id: string;
  it('cria e lista sem authCreds', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/wa/sessions',
      headers: { cookie },
      payload: { label: 'Chip 1' },
    });
    expect(c.statusCode).toBe(201);
    id = c.json().id;
    const l = await app.inject({ method: 'GET', url: '/api/v1/wa/sessions', headers: { cookie } });
    expect(l.json()).toHaveLength(1);
    expect(l.json()[0]).toMatchObject({ id, label: 'Chip 1', status: 'DISCONNECTED' });
    expect(l.json()[0].authCreds).toBeUndefined();
  });
  it('connect enfileira comando e marca CONNECTING', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/wa/sessions/${id}/connect`,
      headers: { cookie },
      payload: { mode: 'pair', phone: '5511999999999' },
    });
    expect(r.statusCode).toBe(202);
    const jobs = await getQueue<WaCommandJob>(QUEUE_WA_COMMANDS).getJobs(['waiting', 'delayed']);
    expect(jobs.map((j) => j.data)).toContainEqual({
      tenantId: t.tenantId,
      sessionId: id,
      command: 'connect',
      mode: 'pair',
      phone: '5511999999999',
    });
    const s = await prisma.waSession.findUnique({ where: { id } });
    expect(s?.status).toBe('CONNECTING');
  });
  it('sessão de outro tenant → 404', async () => {
    const otherSession = await prisma.waSession.create({
      data: { tenantId: other.tenantId, label: 'x' },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/wa/sessions/${otherSession.id}/connect`,
      headers: { cookie },
      payload: { mode: 'qr' },
    });
    expect(r.statusCode).toBe(404);
  });
  it('lista grupos da sessão ordenados por nome', async () => {
    await prisma.waGroup.create({
      data: {
        tenantId: t.tenantId,
        sessionId: id,
        jid: '1@g.us',
        name: 'Zeta',
        kind: 'GROUP',
        botIsAdmin: true,
      },
    });
    await prisma.waGroup.create({
      data: {
        tenantId: t.tenantId,
        sessionId: id,
        jid: '2@newsletter',
        name: 'Alfa',
        kind: 'CHANNEL',
      },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/wa/sessions/${id}/groups`,
      headers: { cookie },
    });
    expect(r.json().map((g: { name: string }) => g.name)).toEqual(['Alfa', 'Zeta']);
  });
  it('delete remove a sessão', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/v1/wa/sessions/${id}`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(204);
    expect(await prisma.waSession.findUnique({ where: { id } })).toBeNull();
  });
});
