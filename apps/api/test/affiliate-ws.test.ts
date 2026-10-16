import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let admin: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
let adminCookie: string;
let affCookie: string;
let url: string;

beforeAll(async () => {
  admin = await createTenantWithUser('admin');
  await prisma.user.update({ where: { id: admin.userId }, data: { isSuperAdmin: true } });
  aff = await createTenantWithUser('afiliado', admin.tenantId);
  adminCookie = await loginCookie(app, admin.email, admin.password);
  affCookie = await loginCookie(app, aff.email, aff.password);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  url = `ws://127.0.0.1:${port}/api/v1/ws`;
});
afterAll(async () => {
  await cleanupTenant(admin.tenantId);
  await app.close();
});

describe('desativar afiliado derruba os WebSockets abertos', () => {
  it('o socket aberto fecha com 4403 e a sessão apagada barra um novo handshake', async () => {
    const ws = new WebSocket(url, { headers: { cookie: affCookie } });
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/affiliates/${aff.tenantId}/active`,
      headers: { cookie: adminCookie },
      payload: { active: false },
    });
    expect(res.statusCode).toBe(204);
    const code = await Promise.race([
      closed,
      new Promise<number>((r) => setTimeout(() => r(-1), 3000)),
    ]);
    expect(code).toBe(4403);
    const again = new WebSocket(url, { headers: { cookie: affCookie } });
    expect(await new Promise<number>((r) => again.on('close', (c) => r(c)))).toBe(4401);
  });
});
