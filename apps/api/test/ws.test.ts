import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { REDIS_EVENTS_CHANNEL } from '@afilados/shared';
import { buildApp } from '../src/app';
import { getRedis } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let url: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  other = await createTenantWithUser('other');
  cookie = await loginCookie(app, t.email, t.password);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  url = `ws://127.0.0.1:${port}/api/v1/ws`;
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

function nextMessage(ws: WebSocket, ms = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout')), ms);
    ws.once('message', (d) => {
      clearTimeout(to);
      resolve(JSON.parse(d.toString()));
    });
  });
}

describe('WS /ws', () => {
  it('sem cookie → fecha 4401', async () => {
    const ws = new WebSocket(url);
    const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
    expect(code).toBe(4401);
  });
  it('recebe só eventos do próprio tenant', async () => {
    const ws = new WebSocket(url, { headers: { cookie } });
    await new Promise((r) => ws.once('open', r));
    const pub = getRedis().duplicate();
    await pub.publish(
      REDIS_EVENTS_CHANNEL,
      JSON.stringify({
        tenantId: other.tenantId,
        event: { type: 'error', code: 'X', message: 'nao' },
      }),
    );
    await pub.publish(
      REDIS_EVENTS_CHANNEL,
      JSON.stringify({
        tenantId: t.tenantId,
        event: { type: 'wa.status', sessionId: 's1', status: 'CONNECTED' },
      }),
    );
    const msg = await nextMessage(ws);
    expect(msg).toEqual({ type: 'wa.status', sessionId: 's1', status: 'CONNECTED' });
    ws.close();
    await pub.quit();
  });
});
