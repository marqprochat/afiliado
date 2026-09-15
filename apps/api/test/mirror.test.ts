import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

process.env.SHOPEE_MOCK = '1';
const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let sessionId: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
  const session = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 'sessao-1', status: 'CONNECTED' },
  });
  sessionId = session.id;
  await prisma.waGroup.createMany({
    data: [
      { tenantId: t.tenantId, sessionId, jid: 'origem1@g.us', name: 'Grupo Origem 1' },
      { tenantId: t.tenantId, sessionId, jid: 'origem2@g.us', name: 'Grupo Origem 2' },
      { tenantId: t.tenantId, sessionId, jid: 'destino1@g.us', name: 'Grupo Destino 1' },
    ],
  });
});

afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('API mirror routes', () => {
  let ruleId: string;

  it('POST /mirror/rules rejeita grupos inexistentes ou de outra sessão', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mirror/rules',
      headers: { cookie },
      payload: {
        name: 'Regra Teste',
        sessionId,
        sourceJids: ['fantasma@g.us'],
        targetJids: ['destino1@g.us'],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /mirror/rules cria regra com sucesso', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mirror/rules',
      headers: { cookie },
      payload: {
        name: 'Regra Teste',
        sessionId,
        sourceJids: ['origem1@g.us', 'origem2@g.us'],
        targetJids: ['destino1@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        dedupHours: 24,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      name: 'Regra Teste',
      sessionId,
      mode: 'CLONE',
      mediaMode: 'PREVIEW',
      dedupHours: 24,
      enabled: true,
      counts: { mirrored: 0, discarded: 0, error: 0 },
    });
    ruleId = body.id;
  });

  it('GET /mirror/rules lista regras com contadores', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/mirror/rules',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe(ruleId);
  });

  it('POST /mirror/rules/:id/toggle alterna o status enabled', async () => {
    const toggle1 = await app.inject({
      method: 'POST',
      url: `/api/v1/mirror/rules/${ruleId}/toggle`,
      headers: { cookie },
    });
    expect(toggle1.statusCode).toBe(200);
    expect(toggle1.json()).toEqual({ id: ruleId, enabled: false });

    const toggle2 = await app.inject({
      method: 'POST',
      url: `/api/v1/mirror/rules/${ruleId}/toggle`,
      headers: { cookie },
    });
    expect(toggle2.statusCode).toBe(200);
    expect(toggle2.json()).toEqual({ id: ruleId, enabled: true });
  });

  it('PUT /mirror/rules/:id atualiza campos da regra', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/mirror/rules/${ruleId}`,
      headers: { cookie },
      payload: {
        name: 'Regra Renomeada',
        sessionId,
        sourceJids: ['origem1@g.us'],
        targetJids: ['destino1@g.us'],
        mode: 'TEMPLATE',
        mediaMode: 'IMAGE',
        dedupHours: 6,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: ruleId,
      name: 'Regra Renomeada',
      mode: 'TEMPLATE',
      mediaMode: 'IMAGE',
      dedupHours: 6,
    });
  });

  it('GET /mirror/logs lista logs enriquecidos com nomes de grupos', async () => {
    await prisma.mirrorLog.create({
      data: {
        tenantId: t.tenantId,
        ruleId,
        sourceJid: 'origem1@g.us',
        sourceMsgId: 'msg-1',
        targetJid: 'destino1@g.us',
        status: 'MIRRORED',
        productKey: 'AMAZON:B01',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/mirror/logs',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const logs = res.json();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: 'MIRRORED',
      sourceName: 'Grupo Origem 1',
      targetName: 'Grupo Destino 1',
    });
  });

  it('GET /mirror/stats retorna resumo diário', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/mirror/stats',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      today: { mirrored: 1, discarded: 0, error: 0 },
    });
  });

  it('DELETE /mirror/rules/:id remove a regra e cascateia logs', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/mirror/rules/${ruleId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);

    const checkRules = await app.inject({
      method: 'GET',
      url: '/api/v1/mirror/rules',
      headers: { cookie },
    });
    expect(checkRules.json()).toHaveLength(0);

    const logCount = await prisma.mirrorLog.count({ where: { ruleId } });
    expect(logCount).toBe(0);
  });
});
