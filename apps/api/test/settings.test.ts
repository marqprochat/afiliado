import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('settings', () => {
  it('GET devolve defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      window: {
        startTime: '07:30',
        endTime: '23:30',
        timezone: 'America/Sao_Paulo',
        enabled: true,
      },
      queueLimit: 500,
      globalRateLimitPerMin: 6,
      subIdPattern: '{yyyyMMdd}-{batchId}',
    });
  });
  it('PUT atualiza parcialmente e persiste', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { window: { endTime: '22:00' }, queueLimit: 100 },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: { cookie } });
    expect(get.json()).toMatchObject({
      window: { startTime: '07:30', endTime: '22:00' },
      queueLimit: 100,
      globalRateLimitPerMin: 6,
    });
  });
  it('PUT com HH:mm inválido → 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: { window: { startTime: '25:00' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
