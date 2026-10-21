import pino from 'pino';
import { prisma, decryptJson, type ProductSource } from '@afilados/db';
import {
  TelegramClient,
  type TelegramCallbackQuery,
  type TelegramInlineKeyboardButton,
  type TelegramMessage,
} from '@afilados/telegram';
import { parseOfferText } from '@afilados/core';
import type { ProductData } from '@afilados/shared';
import { publishEvent } from '../lib/events';
import { convertOfferText as defaultConvertOfferText } from './converter';
import { addItemToBatch as defaultAddItemToBatch } from './batch-adder';
import { fetchProductWithCache as defaultFetchProduct } from '../processors/product-enrich';
import { downloadImageBuffer as defaultDownloadImage } from '../lib/image-fetch';

const log = pino({ name: 'telegram-manager' });

interface RunningBot {
  stopped: boolean;
}

interface PendingOfferSession {
  sessionKey: string;
  userId: number;
  tenantId: string;
  botId: string;
  step: 'waiting_coupon' | 'choosing_batch';
  isLinkOnly: boolean;
  convertedText: string;
  originalUrl?: string | undefined;
  source?: string | undefined;
  productData?: ProductData | undefined;
  couponCode?: string | undefined;
  imageBuffer?: Buffer | undefined;
  imageMime?: string | undefined;
  createdAt: number;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isLinkOnlyOffer(text: string, urls: string[]): boolean {
  if (urls.length !== 1) return false;
  const url = urls[0]!;
  const remaining = text.replace(url, '').trim();
  const lines = remaining.split('\n').filter((l) => l.trim().length > 0);
  return remaining.length <= 60 && lines.length <= 2;
}

function extractTitleFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const pathname = decodeURIComponent(u.pathname);
    // Shopee: /Nome-do-Produto-i.123.456
    const shopeeMatch = pathname.match(/^\/([^/]+)-i\.\d+\.\d+/);
    if (shopeeMatch) {
      return shopeeMatch[1]!.replace(/[-_]+/g, ' ').trim();
    }
    // ML: /MLB-12345-nome-do-produto or /p/MLB123
    const parts = pathname.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1] ?? '';
    const clean = lastPart.replace(/^MLB-?\d*-?/i, '').replace(/[-_]+/g, ' ').trim();
    if (clean.length > 5) return clean;
    if (parts[0] && parts[0].length > 5) return parts[0].replace(/[-_]+/g, ' ').trim();
  } catch {}
  return 'Oferta Especial';
}

function makeBatchKeyboard(
  batches: Array<{ id: string; name: string; status: string; items: Array<{ status: string }> }>,
  sessionKey: string,
): TelegramInlineKeyboardButton[][] {
  const keyboard: TelegramInlineKeyboardButton[][] = batches.map((b) => {
    const pendingCount = b.items.filter((i) => i.status === 'PENDING').length;
    return [
      {
        text: `📦 ${b.name} (${pendingCount} pend.) [${b.status}]`,
        callback_data: `tg_batch:${b.id}:${sessionKey}`,
      },
    ];
  });
  keyboard.push([{ text: '❌ Cancelar', callback_data: `tg_cancel:${sessionKey}` }]);
  return keyboard;
}

export interface TelegramManagerDeps {
  makeClient?: (token: string) => TelegramClient;
  convertOffer?: typeof defaultConvertOfferText;
  addBatchItem?: typeof defaultAddItemToBatch;
  fetchProduct?: (
    tenantId: string,
    kind: any,
    url: string,
  ) => Promise<ProductData | null>;
  downloadImage?: (url: string) => Promise<Buffer | undefined>;
}

export class TelegramManager {
  private running = new Map<string, RunningBot>();
  private pendingSessions = new Map<string, PendingOfferSession>();
  private makeClient: (token: string) => TelegramClient;
  private convertOffer: typeof defaultConvertOfferText;
  private addBatchItem: typeof defaultAddItemToBatch;
  private fetchProduct: (tenantId: string, kind: any, url: string) => Promise<ProductData | null>;
  private downloadImage: (url: string) => Promise<Buffer | undefined>;

  constructor(deps: TelegramManagerDeps = {}) {
    this.makeClient = deps.makeClient ?? ((token: string) => new TelegramClient(token));
    this.convertOffer = deps.convertOffer ?? defaultConvertOfferText;
    this.addBatchItem = deps.addBatchItem ?? defaultAddItemToBatch;
    this.fetchProduct = deps.fetchProduct ?? defaultFetchProduct;
    this.downloadImage = deps.downloadImage ?? defaultDownloadImage;
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

  private async sendBatchOptions(
    bot: { id: string; tenantId: string },
    client: TelegramClient,
    chatId: string | number,
    session: PendingOfferSession,
  ): Promise<void> {
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
        String(chatId),
        `⚠️ Você ainda não possui nenhum lote criado no sistema. Crie um lote no painel para receber envios.`,
      );
      this.pendingSessions.delete(session.sessionKey);
      return;
    }

    const inlineKeyboard = makeBatchKeyboard(batches, session.sessionKey);

    let previewText = '';
    if (session.isLinkOnly && session.productData) {
      const priceStr =
        session.productData.price > 0
          ? Number(session.productData.price).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })
          : '';
      previewText =
        `📦 <b>Produto:</b> ${escapeHtml(session.productData.title)}\n` +
        (priceStr ? `💰 <b>Preço:</b> ${priceStr}\n` : '') +
        (session.couponCode ? `🏷️ <b>Cupom:</b> <code>${escapeHtml(session.couponCode)}</code>\n` : '') +
        `<i>✨ A mensagem será gerada respeitando o template do lote escolhido.</i>`;
    } else {
      const preview =
        session.convertedText.length > 300
          ? session.convertedText.slice(0, 300) + '...'
          : session.convertedText;
      previewText = `📝 <b>Prévia do texto:</b>\n<pre>${escapeHtml(preview)}</pre>`;
    }

    await client.sendMessage(
      String(chatId),
      `${previewText}\n\n📦 <b>Em qual lote deseja enviar?</b> Escolha abaixo:`,
      {
        replyMarkup: {
          inline_keyboard: inlineKeyboard,
        },
      },
    );
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
          `Envie ou encaminhe uma mensagem de promoção (colada de outro grupo ou apenas o link do produto, com ou sem foto).\n\n` +
          `⚙️ <b>Como funciona:</b>\n` +
          `1. Localizo os links da oferta (Shopee, Mercado Livre, Amazon, AliExpress, Magalu, etc.);\n` +
          `2. Converto para os seus links de afiliado cadastrados;\n` +
          `3. Se enviar apenas um link, busco todos os dados do produto, pergunto se deseja cupom e formato conforme o template do lote;\n` +
          `4. Se enviar colagem com texto, converto o link e baixo a imagem original;\n` +
          `5. Você escolhe o lote de destino e o sistema agenda o disparo nos seus grupos!`,
      );
      return;
    }

    if (text === '/cancelar' || text === '/cancel') {
      const active = Array.from(this.pendingSessions.values()).find((s) => s.userId === message.from?.id);
      if (active) {
        this.pendingSessions.delete(active.sessionKey);
        await client.sendMessage(String(message.chat.id), `❌ <i>Operação cancelada com sucesso.</i>`);
      } else {
        await client.sendMessage(String(message.chat.id), `ℹ️ Nenhuma operação pendente no momento.`);
      }
      return;
    }

    // 3. Verifica se o usuário estava na etapa de responder cupom
    const waitingSession = Array.from(this.pendingSessions.values()).find(
      (s) => s.userId === message.from?.id && s.step === 'waiting_coupon',
    );

    if (waitingSession) {
      const parsedUrls = parseOfferText(text).urls;
      // Se o usuário enviou outro link, descarta a sessão anterior e trata como novo link
      if (parsedUrls.length === 0) {
        // Usuário respondeu o cupom em texto!
        waitingSession.couponCode = text.trim();
        waitingSession.step = 'choosing_batch';

        await client.sendMessage(
          String(message.chat.id),
          `🏷️ Cupom <code>${escapeHtml(waitingSession.couponCode)}</code> anotado com sucesso!`,
        );

        await this.sendBatchOptions(bot, client, message.chat.id, waitingSession);
        return;
      } else {
        this.pendingSessions.delete(waitingSession.sessionKey);
      }
    }

    if (!text) {
      await client.sendMessage(
        String(message.chat.id),
        `⚠️ Não encontrei nenhum texto ou link nesta mensagem.\n\nEnvie uma promoção contendo o link do produto.`,
      );
      return;
    }

    // 4. Tenta baixar a foto se a mensagem já contiver imagem no Telegram
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

    // 5. Converte os links da oferta
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

    // 6. Verifica se o usuário enviou apenas um link
    const parsed = parseOfferText(text);
    const isLinkOnly = isLinkOnlyOffer(text, parsed.urls);

    const convertedLinkItem = conv.detected.links.find((l) => l.converted) ?? conv.detected.links[0]!;
    const targetUrl = convertedLinkItem.resolvedUrl || convertedLinkItem.originalUrl;
    const kind = convertedLinkItem.marketplace;

    if (isLinkOnly && kind !== 'UNKNOWN') {
      // "se enviar apenas um link, busque tudo do produto e pergunte se tem cupom para adicionar"
      let productData: ProductData | null = null;
      if (kind !== 'AWIN') {
        try {
          productData = await this.fetchProduct(bot.tenantId, kind as any, targetUrl);
        } catch (err) {
          log.warn({ err, targetUrl, kind }, 'erro ao buscar dados completos do produto');
        }
      }

      // Se a busca falhou ou retornou vazio, usa metadados extraídos da URL para SEMPRE respeitar o template do lote
      if (!productData) {
        const fallbackTitle = extractTitleFromUrl(targetUrl);
        productData = {
          source: kind as any,
          title: fallbackTitle,
          price: 0,
          images: [],
          shipping: 'UNKNOWN',
          originalUrl: targetUrl,
          raw: {},
        };
      }

      // Baixa a foto do produto se não veio imagem no Telegram
      if (!imageBuffer && productData.images && productData.images.length > 0) {
        imageBuffer = await this.downloadImage(productData.images[0]!);
      }

      const sessionKey = `${message.from.id}:${Date.now()}`;
      const session: PendingOfferSession = {
        sessionKey,
        userId: message.from.id,
        tenantId: bot.tenantId,
        botId: bot.id,
        step: 'waiting_coupon',
        isLinkOnly: true,
        convertedText: conv.convertedText,
        originalUrl: targetUrl,
        source: kind,
        productData,
        imageBuffer,
        imageMime,
        createdAt: Date.now(),
      };
      this.pendingSessions.set(sessionKey, session);

      const priceStr =
        productData.price > 0
          ? Number(productData.price).toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })
          : '';
      const origStr = productData.originalPrice
        ? ` <s>${Number(productData.originalPrice).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</s>`
        : '';
      const discStr = productData.discountPct ? ` (-${productData.discountPct}%)` : '';

      await client.sendMessage(
        String(message.chat.id),
        `✅ <b>Link convertido com sucesso!</b>\n\n` +
          `📦 <b>Produto:</b> ${escapeHtml(productData.title)}\n` +
          (priceStr ? `💰 <b>Preço:</b> ${priceStr}${origStr}${discStr}\n\n` : '\n') +
          `🏷️ <b>Deseja adicionar algum cupom para esta oferta?</b>\n\n` +
          `👉 Envie o código do cupom como resposta (ex: <code>PROMO10</code>) ou clique no botão abaixo para continuar sem cupom:`,
        {
          replyMarkup: {
            inline_keyboard: [
              [{ text: '⏭️ Sem cupom', callback_data: `tg_skip_coupon:${sessionKey}` }],
              [{ text: '❌ Cancelar', callback_data: `tg_cancel:${sessionKey}` }],
            ],
          },
        },
      );
      return;
    }

    // Se NÃO é link único ou a busca do produto falhou, tenta baixar foto da URL para nunca ir sem foto
    if (!imageBuffer && kind !== 'UNKNOWN' && kind !== 'AWIN') {
      try {
        const pd = await this.fetchProduct(bot.tenantId, kind as any, targetUrl);
        if (pd?.images?.[0]) {
          imageBuffer = await this.downloadImage(pd.images[0]);
        }
      } catch (err) {
        log.warn({ err }, 'tentativa de baixar imagem para colagem falhou');
      }
    }

    // Armazena a sessão pendente para escolha do lote
    const sessionKey = `${message.from.id}:${Date.now()}`;
    const session: PendingOfferSession = {
      sessionKey,
      userId: message.from.id,
      tenantId: bot.tenantId,
      botId: bot.id,
      step: 'choosing_batch',
      isLinkOnly: false,
      convertedText: conv.convertedText,
      imageBuffer,
      imageMime,
      createdAt: Date.now(),
    };
    this.pendingSessions.set(sessionKey, session);

    await this.sendBatchOptions(bot, client, message.chat.id, session);
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

    if (cq.data.startsWith('tg_skip_coupon:')) {
      const sessionKey = cq.data.replace('tg_skip_coupon:', '');
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

      session.couponCode = undefined;
      session.step = 'choosing_batch';

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
        if (cq.message) {
          await client.editMessageText(
            String(cq.message.chat.id),
            cq.message.messageId,
            '⚠️ Você ainda não possui nenhum lote criado no sistema.',
          );
        }
        return;
      }

      if (cq.message) {
        let preview = '';
        if (session.productData) {
          const priceStr =
            session.productData.price > 0
              ? Number(session.productData.price).toLocaleString('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                })
              : '';
          preview =
            `📦 <b>Produto:</b> ${escapeHtml(session.productData.title)}\n` +
            (priceStr ? `💰 <b>Preço:</b> ${priceStr}\n` : '') +
            `<i>✨ A mensagem será gerada respeitando o template do lote escolhido.</i>\n\n`;
        }
        await client.editMessageText(
          String(cq.message.chat.id),
          cq.message.messageId,
          `${preview}📦 <b>Em qual lote deseja enviar?</b> Escolha abaixo:`,
          {
            replyMarkup: {
              inline_keyboard: makeBatchKeyboard(batches, sessionKey),
            },
          },
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

      let res;
      if (session.isLinkOnly && session.productData) {
        // Cria o produto no banco com os metadados buscados e o cupom (se houver)
        const createdProduct = await prisma.product.create({
          data: {
            tenantId: session.tenantId,
            source: (session.source as ProductSource) ?? 'MANUAL',
            title: session.productData.title,
            price: session.productData.price,
            originalPrice: session.productData.originalPrice ?? null,
            discountPct: session.productData.discountPct ?? null,
            images: session.productData.images ?? [],
            shipping: session.productData.shipping ?? 'UNKNOWN',
            couponCode: session.couponCode ?? session.productData.couponCode ?? null,
            couponValue: session.productData.couponValue ?? null,
            originalUrl: session.originalUrl ?? session.productData.originalUrl,
            raw: (session.productData.raw as object) ?? {},
          },
        });

        res = await this.addBatchItem({
          tenantId: session.tenantId,
          batchId,
          productId: createdProduct.id,
          couponCode: session.couponCode,
          imageBuffer: session.imageBuffer,
          imageMime: session.imageMime,
        });
      } else {
        res = await this.addBatchItem({
          tenantId: session.tenantId,
          batchId,
          customText: session.convertedText,
          imageBuffer: session.imageBuffer,
          imageMime: session.imageMime,
        });
      }

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

      const couponNotice = session.couponCode
        ? `\n🏷️ <b>Cupom aplicado:</b> <code>${escapeHtml(session.couponCode)}</code>`
        : '';
      const templateNotice = session.isLinkOnly
        ? `\n<i>✨ O disparo seguirá rigorosamente o modelo/template do lote.</i>`
        : '';

      if (cq.message) {
        await client.editMessageText(
          String(cq.message.chat.id),
          cq.message.messageId,
          `🚀 <b>Oferta adicionada ao lote com sucesso!</b>\n\n` +
            `📦 <b>Lote:</b> ${res.batchName}\n` +
            `⏰ <b>Previsão de envio:</b> ${timeStr}${couponNotice}${templateNotice}\n` +
            `Status: <i>${res.batchStatus === 'PAUSED' ? 'Pausado (será enviado quando o lote for retomado)' : 'Agendado na fila'}</i>`,
        );
      }
    }
  }
}
