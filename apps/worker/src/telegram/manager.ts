import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  TelegramClient,
  type TelegramCallbackQuery,
  type TelegramInlineKeyboardButton,
  type TelegramMessage,
} from '@afilados/telegram';
import { publishEvent } from '../lib/events';
import { convertOfferText as defaultConvertOfferText } from './converter';
import { addItemToBatch as defaultAddItemToBatch } from './batch-adder';

const log = pino({ name: 'telegram-manager' });

interface RunningBot {
  stopped: boolean;
}

interface PendingOfferSession {
  sessionKey: string;
  userId: number;
  tenantId: string;
  botId: string;
  convertedText: string;
  imageBuffer?: Buffer | undefined;
  imageMime?: string | undefined;
  createdAt: number;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface TelegramManagerDeps {
  makeClient?: (token: string) => TelegramClient;
  convertOffer?: typeof defaultConvertOfferText;
  addBatchItem?: typeof defaultAddItemToBatch;
}

export class TelegramManager {
  private running = new Map<string, RunningBot>();
  private pendingSessions = new Map<string, PendingOfferSession>();
  private makeClient: (token: string) => TelegramClient;
  private convertOffer: typeof defaultConvertOfferText;
  private addBatchItem: typeof defaultAddItemToBatch;

  constructor(deps: TelegramManagerDeps = {}) {
    this.makeClient = deps.makeClient ?? ((token: string) => new TelegramClient(token));
    this.convertOffer = deps.convertOffer ?? defaultConvertOfferText;
    this.addBatchItem = deps.addBatchItem ?? defaultAddItemToBatch;
  }

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
    this.pendingSessions.clear();
  }

  botCount() {
    return this.running.size;
  }

  private cleanOldSessions() {
    const now = Date.now();
    const MAX_AGE = 15 * 60 * 1000; // 15 minutos
    for (const [key, session] of this.pendingSessions.entries()) {
      if (now - session.createdAt > MAX_AGE) {
        this.pendingSessions.delete(key);
      }
    }
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
        const client = this.makeClient(token);
        const { nextOffset, chatUpdates, messages, callbackQueries } = await client.getUpdates(
          bot.updatesOffset,
          25,
        );

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

        // Processa mensagens recebidas (ofertas coladas ou encaminhadas)
        if (messages.length > 0) {
          this.cleanOldSessions();
          for (const m of messages) {
            await this.handleMessage(bot, client, m).catch((err) => {
              log.warn({ botId, messageId: m.messageId, err }, 'erro ao processar mensagem do telegram');
            });
          }
        }

        // Processa cliques em botões inline (escolha do lote ou cancelamento)
        if (callbackQueries.length > 0) {
          this.cleanOldSessions();
          for (const cq of callbackQueries) {
            await this.handleCallbackQuery(bot, client, cq).catch((err) => {
              log.warn({ botId, queryId: cq.id, err }, 'erro ao processar callback query do telegram');
            });
          }
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

  private async handleMessage(
    bot: { id: string; tenantId: string; allowedUserIds: string[] },
    client: TelegramClient,
    message: TelegramMessage,
  ): Promise<void> {
    // Apenas mensagens privadas (direto com o bot) para interação de conversão
    if (message.chat.type !== 'private') return;
    if (!message.from) return;

    const senderIdStr = String(message.from.id);
    const allowed = (bot.allowedUserIds ?? []).map((id) => id.trim()).filter(Boolean);

    // 1. Verificação da lista de IDs cadastrados
    if (allowed.length === 0 || !allowed.includes(senderIdStr)) {
      await client.sendMessage(
        String(message.chat.id),
        `⛔ <b>Acesso não autorizado.</b>\n\n` +
          `Seu ID de usuário do Telegram é: <code>${senderIdStr}</code>.\n\n` +
          `Para usar este bot para converter links e enviar promoções aos lotes, adicione o seu ID na lista de IDs autorizados nas configurações do painel Afilados.`,
      );
      return;
    }

    const text = (message.text ?? message.caption ?? '').trim();

    // 2. Comandos de ajuda ou início
    if (text === '/start' || text === '/ajuda' || text === '/help') {
      await client.sendMessage(
        String(message.chat.id),
        `👋 <b>Olá, ${message.from.firstName ?? 'afiliado'}!</b>\n\n` +
          `Envie ou encaminhe uma mensagem de promoção (colada de outro grupo ou canal, com ou sem foto).\n\n` +
          `⚙️ <b>Como funciona:</b>\n` +
          `1. Localizo os links da oferta (Shopee, Mercado Livre, Amazon, AliExpress, Magalu, etc.);\n` +
          `2. Converto para os seus links de afiliado cadastrados;\n` +
          `3. Se não conseguir converter o link, aviso e finalizo;\n` +
          `4. Se converter com sucesso, pergunto em qual lote você deseja adicionar o envio.`,
      );
      return;
    }

    if (!text) {
      await client.sendMessage(
        String(message.chat.id),
        `⚠️ Não encontrei nenhum texto ou link nesta mensagem.\n\nEnvie uma promoção contendo o link do produto.`,
      );
      return;
    }

    // 3. Tenta baixar a foto se a mensagem contiver imagem
    let imageBuffer: Buffer | undefined;
    let imageMime = 'image/jpeg';
    if (message.photo && message.photo.length > 0) {
      try {
        const bestPhoto = message.photo[message.photo.length - 1]!;
        const file = await client.getFile(bestPhoto.fileId);
        if (file.filePath) {
          imageBuffer = await client.downloadFile(file.filePath);
        }
      } catch (err) {
        log.warn({ err }, 'não foi possível baixar a imagem da mensagem');
      }
    }

    // 4. Converte os links da oferta
    const conv = await this.convertOffer(bot.tenantId, text);

    // Se NÃO conseguiu converter o link: avisa e finaliza
    if (!conv.hasConvertedLink) {
      await client.sendMessage(
        String(message.chat.id),
        `⚠️ <b>Não foi possível converter o link da promoção.</b>\n\n` +
          `<b>Motivo:</b> ${conv.failureReason ?? 'Nenhum link suportado foi identificado'}\n\n` +
          `<i>A interação foi finalizada.</i>`,
      );
      return;
    }

    // 5. Conseguiu converter o link! Busca os lotes disponíveis no tenant
    const batches = await prisma.batch.findMany({
      where: {
        tenantId: bot.tenantId,
        status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED', 'DONE'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { items: { select: { status: true } } },
    });

    if (batches.length === 0) {
      await client.sendMessage(
        String(message.chat.id),
        `✅ <b>Link convertido com sucesso!</b>\n\n` +
          `⚠️ Porém, você ainda não possui nenhum lote criado no sistema. Crie um lote no painel para receber envios.`,
      );
      return;
    }

    // 6. Armazena a sessão pendente
    const sessionKey = `${message.from.id}:${Date.now()}`;
    this.pendingSessions.set(sessionKey, {
      sessionKey,
      userId: message.from.id,
      tenantId: bot.tenantId,
      botId: bot.id,
      convertedText: conv.convertedText,
      imageBuffer,
      imageMime,
      createdAt: Date.now(),
    });

    // 7. Monta botões inline com a lista de lotes
    const inlineKeyboard: TelegramInlineKeyboardButton[][] = batches.map((b) => {
      const pendingCount = b.items.filter((i) => i.status === 'PENDING').length;
      return [
        {
          text: `📦 ${b.name} (${pendingCount} pend.) [${b.status}]`,
          callback_data: `tg_batch:${b.id}:${sessionKey}`,
        },
      ];
    });
    inlineKeyboard.push([{ text: '❌ Cancelar', callback_data: `tg_cancel:${sessionKey}` }]);

    const preview =
      conv.convertedText.length > 300
        ? conv.convertedText.slice(0, 300) + '...'
        : conv.convertedText;

    await client.sendMessage(
      String(message.chat.id),
      `✅ <b>Link convertido com sucesso!</b>\n\n` +
        `📝 <b>Prévia do texto:</b>\n<pre>${escapeHtml(preview)}</pre>\n\n` +
        `📦 <b>Em qual lote deseja enviar?</b> Escolha abaixo:`,
      {
        replyMarkup: {
          inline_keyboard: inlineKeyboard,
        },
      },
    );
  }

  private async handleCallbackQuery(
    bot: { id: string; tenantId: string },
    client: TelegramClient,
    cq: TelegramCallbackQuery,
  ): Promise<void> {
    await client.answerCallbackQuery(cq.id).catch(() => {});

    if (!cq.data) return;

    if (cq.data.startsWith('tg_cancel:')) {
      const sessionKey = cq.data.replace('tg_cancel:', '');
      this.pendingSessions.delete(sessionKey);
      if (cq.message) {
        await client.editMessageText(
          String(cq.message.chat.id),
          cq.message.messageId,
          '❌ <i>Envio cancelado pelo usuário.</i>',
        );
      }
      return;
    }

    if (cq.data.startsWith('tg_batch:')) {
      const parts = cq.data.split(':');
      const batchId = parts[1];
      const sessionKey = parts.slice(2).join(':');

      if (!batchId || !sessionKey) return;

      const session = this.pendingSessions.get(sessionKey);
      if (!session) {
        if (cq.message) {
          await client.editMessageText(
            String(cq.message.chat.id),
            cq.message.messageId,
            '⚠️ <i>Esta sessão expirou. Por favor, envie a promoção novamente.</i>',
          );
        }
        return;
      }

      this.pendingSessions.delete(sessionKey);

      const res = await this.addBatchItem({
        tenantId: session.tenantId,
        batchId,
        customText: session.convertedText,
        imageBuffer: session.imageBuffer,
        imageMime: session.imageMime,
      });

      if (!res.success) {
        if (cq.message) {
          await client.editMessageText(
            String(cq.message.chat.id),
            cq.message.messageId,
            `❌ <b>Erro ao adicionar ao lote:</b> ${res.error ?? 'falha desconhecida'}`,
          );
        }
        return;
      }

      const timeStr = res.runAt
        ? res.runAt.toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Ao retomar o lote';

      if (cq.message) {
        await client.editMessageText(
          String(cq.message.chat.id),
          cq.message.messageId,
          `🚀 <b>Promoção adicionada ao lote com sucesso!</b>\n\n` +
            `📦 <b>Lote:</b> ${res.batchName}\n` +
            `⏰ <b>Previsão de envio:</b> ${timeStr}\n` +
            `Status: <i>${res.batchStatus === 'PAUSED' ? 'Pausado (será enviado quando o lote for retomado)' : 'Agendado na fila'}</i>`,
        );
      }
    }
  }
}
