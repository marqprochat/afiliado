import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decryptJson, encryptJson } from '@afilados/db';
import { ApiError, telegramBotCreateSchema, telegramBotUpdateSchema } from '@afilados/shared';
import { TelegramClient } from '@afilados/telegram';
import { requireAuth } from '../plugins/auth';

const idParam = z.object({ id: z.string().min(1) });

interface TokenPayload {
  token: string;
}

function publicBot(row: {
  id: string;
  label: string;
  username: string | null;
  allowedUserIds: string[];
  status: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
}) {
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    allowedUserIds: row.allowedUserIds ?? [],
    status: row.status,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt,
  };
}

export async function telegramRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/telegram/bots', async (req) => {
    const rows = await req.db.telegramBot.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(publicBot);
  });

  app.post('/telegram/bots', async (req, reply) => {
    const body = telegramBotCreateSchema.parse(req.body);
    let me;
    try {
      me = await new TelegramClient(body.token).getMe();
    } catch (e) {
      throw new ApiError('TELEGRAM_ERROR', e instanceof Error ? e.message : 'token inválido', 400);
    }
    const row = await req.db.telegramBot.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: {
        label: body.label,
        encryptedToken: encryptJson({ token: body.token } satisfies TokenPayload),
        username: me.username ?? null,
        allowedUserIds: body.allowedUserIds ?? [],
        status: 'OK',
        lastCheckedAt: new Date(),
      },
    });
    await app.events.publish(req.tenantId, { type: 'telegram.bots.changed' });
    return reply.status(201).send(publicBot(row));
  });

  app.patch('/telegram/bots/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = telegramBotUpdateSchema.parse(req.body);
    const bot = await req.db.telegramBot.findFirst({ where: { id } });
    if (!bot) throw ApiError.notFound('Bot não encontrado');

    const data: { label?: string; allowedUserIds?: string[] } = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.allowedUserIds !== undefined) {
      data.allowedUserIds = Array.from(new Set(body.allowedUserIds.map((u) => u.trim()).filter(Boolean)));
    }

    await req.db.telegramBot.updateMany({
      where: { id },
      data,
    });
    const updated = await req.db.telegramBot.findFirst({ where: { id } });
    if (!updated) throw ApiError.notFound('Bot não encontrado');
    await app.events.publish(req.tenantId, { type: 'telegram.bots.changed' });
    return publicBot(updated);
  });

  app.post('/telegram/bots/:id/check', async (req) => {
    const { id } = idParam.parse(req.params);
    const bot = await req.db.telegramBot.findFirst({ where: { id } });
    if (!bot) throw ApiError.notFound('Bot não encontrado');
    const { token } = decryptJson<TokenPayload>(Buffer.from(bot.encryptedToken));
    let status: 'OK' | 'ERROR' = 'OK';
    let lastError: string | null = null;
    let username = bot.username;
    try {
      const me = await new TelegramClient(token).getMe();
      username = me.username ?? null;
    } catch (e) {
      status = 'ERROR';
      lastError = e instanceof Error ? e.message : 'falha desconhecida';
    }
    await req.db.telegramBot.updateMany({
      where: { id },
      data: { status, lastError, username, lastCheckedAt: new Date() },
    });
    const row = await req.db.telegramBot.findFirst({ where: { id } });
    if (!row) throw ApiError.notFound('Bot não encontrado');
    return publicBot(row);
  });

  app.delete('/telegram/bots/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await req.db.telegramBot.deleteMany({ where: { id } });
    if (r.count === 0) throw ApiError.notFound('Bot não encontrado');
    await app.events.publish(req.tenantId, { type: 'telegram.bots.changed' });
    return reply.status(204).send();
  });

  app.get('/telegram/chats', async (req) => {
    return req.db.telegramChat.findMany({ where: { botIsAdmin: true }, orderBy: { title: 'asc' } });
  });

  app.get('/telegram/bots/:id/chats', async (req) => {
    const { id } = idParam.parse(req.params);
    const bot = await req.db.telegramBot.findFirst({ where: { id } });
    if (!bot) throw ApiError.notFound('Bot não encontrado');
    return req.db.telegramChat.findMany({ where: { botId: id }, orderBy: { title: 'asc' } });
  });
}
