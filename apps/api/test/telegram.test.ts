import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
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

describe('telegram bots', () => {
  it('lista vazia quando nenhum bot foi criado', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/telegram/bots',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });

  it('token com formato inválido → 400, sem tentar chamar a API do Telegram', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/bots',
      headers: { cookie },
      payload: { label: 'Bot Ofertas', token: 'nao-e-um-token-valido' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('lista chats de bot inexistente → 404', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/telegram/bots/nao-existe/chats',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it('delete de bot inexistente → 404', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: '/api/v1/telegram/bots/nao-existe',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it('lista chats de um bot já cadastrado (sem depender de rede)', async () => {
    const bot = await prisma.telegramBot.create({
      data: {
        tenantId: t.tenantId,
        label: 'Bot Teste',
        encryptedToken: Buffer.from('fake'),
        status: 'OK',
      },
    });
    await prisma.telegramChat.create({
      data: {
        tenantId: t.tenantId,
        botId: bot.id,
        chatId: '-100123',
        title: 'Ofertas VIP',
        kind: 'supergroup',
        botIsAdmin: true,
      },
    });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/telegram/bots/${bot.id}/chats`,
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject([{ chatId: '-100123', title: 'Ofertas VIP', botIsAdmin: true }]);
  });
});
