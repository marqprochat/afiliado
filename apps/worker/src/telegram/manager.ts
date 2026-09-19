import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import { TelegramClient } from '@afilados/telegram';
import { publishEvent } from '../lib/events';

const log = pino({ name: 'telegram-manager' });

interface RunningBot {
  stopped: boolean;
}

/**
 * A Bot API do Telegram não tem "listar todos os chats do bot" — a única forma de
 * descobrir em quais grupos/canais o bot está é via long polling em getUpdates,
 * observando os eventos my_chat_member (adicionado/promovido/removido). Por isso,
 * ao contrário do WhatsApp, não existe um "sincronizar" sob demanda: o polling
 * roda continuamente enquanto o bot estiver configurado.
 */
export class TelegramManager {
  private running = new Map<string, RunningBot>();

  async start() {
    await this.reload();
  }

  async reload() {
    const bots = await prisma.telegramBot.findMany();
    const activeIds = new Set(bots.map((b) => b.id));
    for (const [id, state] of this.running) {
      if (!activeIds.has(id)) state.stopped = true;
    }
    for (const bot of bots) {
      if (!this.running.has(bot.id)) {
        const state: RunningBot = { stopped: false };
        this.running.set(bot.id, state);
        void this.pollLoop(bot.id, bot.tenantId, state);
      }
    }
  }

  stop() {
    for (const state of this.running.values()) state.stopped = true;
    this.running.clear();
  }

  botCount() {
    return this.running.size;
  }

  private async pollLoop(botId: string, tenantId: string, state: RunningBot) {
    while (!state.stopped) {
      try {
        const bot = await prisma.telegramBot.findUnique({ where: { id: botId } });
        if (!bot) {
          state.stopped = true;
          break;
        }
        const { token } = decryptJson<{ token: string }>(Buffer.from(bot.encryptedToken));
        const client = new TelegramClient(token);
        const { nextOffset, chatUpdates } = await client.getUpdates(bot.updatesOffset, 25);
        if (chatUpdates.length > 0) {
          await prisma.$transaction(
            chatUpdates.map((c) =>
              prisma.telegramChat.upsert({
                where: { botId_chatId: { botId, chatId: c.chatId } },
                update: {
                  title: c.title,
                  kind: c.kind,
                  botIsAdmin: c.botIsAdmin,
                  syncedAt: new Date(),
                },
                create: {
                  tenantId,
                  botId,
                  chatId: c.chatId,
                  title: c.title,
                  kind: c.kind,
                  botIsAdmin: c.botIsAdmin,
                },
              }),
            ),
          );
          await publishEvent(tenantId, {
            type: 'telegram.chats.synced',
            botId,
            count: chatUpdates.length,
          });
        }
        if (nextOffset !== bot.updatesOffset || bot.status !== 'OK') {
          await prisma.telegramBot.updateMany({
            where: { id: botId },
            data: { updatesOffset: nextOffset, status: 'OK', lastError: null },
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.warn({ botId, err: message }, 'falha no polling do telegram');
        await prisma.telegramBot
          .updateMany({ where: { id: botId }, data: { status: 'ERROR', lastError: message } })
          .catch(() => {});
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    this.running.delete(botId);
  }
}
