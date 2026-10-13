import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { cleanupTenant, loginCookie } from './helpers';
import { addGroup, addSendLog, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const app = await buildApp({ logger: false });
const from = '2026-09-01T03:00:00.000Z';
const to = '2026-09-08T03:00:00.000Z';
const qs = (extra = '') => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${extra}`;
let a: MetricsCtx;
let b: MetricsCtx;
let cookie: string;

beforeAll(async () => {
  a = await createMetricsTenant('routes-a');
  b = await createMetricsTenant('routes-b');
  cookie = await loginCookie(app, a.email, a.password);
  await addGroup(a, 'rt-a@g.us', { name: 'A', memberCount: 10 });
  await addGroup(b, 'rt-b@g.us', { name: 'B', memberCount: 99 });
  await addSendLog(a, 'rt-a@g.us', '2026-09-02T12:00:00Z');
  await addSendLog(b, 'rt-b@g.us', '2026-09-02T12:00:00Z');
  await addSendLog(b, 'rt-b@g.us', '2026-09-02T13:00:00Z', 'ERROR', { error: 'x' });
});

afterAll(async () => {
  await cleanupTenant(a.tenantId);
  await cleanupTenant(b.tenantId);
  await app.close();
});

const get = (path: string, withCookie = true) =>
  app.inject({ method: 'GET', url: `/api/v1${path}`, headers: withCookie ? { cookie } : {} });

describe('rotas /metrics', () => {
  it('exigem autenticação', async () => {
    const res = await get(`/metrics/overview?${qs()}`, false);
    expect(res.statusCode).toBe(401);
  });

  it.each(['overview', 'groups', 'sends', 'products', 'clicks', 'automation'])(
    'GET /metrics/%s responde 200',
    async (panel) => {
      const res = await get(`/metrics/${panel}?${qs()}`);
      expect(res.statusCode).toBe(200);
    },
  );

  it.each([
    ['sem from', `to=${encodeURIComponent(to)}`],
    ['sem to', `from=${encodeURIComponent(from)}`],
    ['data inválida', `from=abc&to=${encodeURIComponent(to)}`],
    ['to antes de from', `from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`],
    ['mais de 366 dias', 'from=2025-01-01T00:00:00Z&to=2026-01-03T00:00:00Z'],
  ])('400 quando %s', async (_label, query) => {
    const res = await get(`/metrics/sends?${query}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('grupo de outro tenant devolve 404', async () => {
    const res = await get(`/metrics/sends?${qs('&groupJid=rt-b%40g.us')}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('grupo do próprio tenant filtra', async () => {
    const res = await get(`/metrics/sends?${qs('&groupJid=rt-a%40g.us')}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.total).toBe(1);
  });

  it('não vaza dados de outro tenant', async () => {
    const sends = (await get(`/metrics/sends?${qs()}`)).json();
    expect(sends.totals).toEqual({ total: 1, sent: 1, failed: 0, successRate: 100 });
    expect(sends.heatmap).toHaveLength(168);
    const overview = (await get(`/metrics/overview?${qs()}`)).json();
    expect(overview.kpis.sends.current).toBe(1);
    expect(overview.kpis.members.current).toBe(10);
    expect(overview.groupOptions).toEqual([{ jid: 'rt-a@g.us', name: 'A' }]);
  });
});
