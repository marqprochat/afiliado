import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  generateSubId,
  isEligibleCoupon,
  renderCouponTemplate,
  renderTemplate,
  whatsappToTelegramHtml,
} from '@afilados/core';
import {
  getAliexpressAdapter,
  getTagAdapter,
  type AliexpressCredentials,
  type AwinCredentials,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import { TelegramClient } from '@afilados/telegram';
import type { ProductData, SendTelegramJob, TagCredentials } from '@afilados/shared';

const log = pino({ name: 'send-telegram' });

/** Limite de legenda de foto da Bot API do Telegram. */
const TELEGRAM_CAPTION_MAX = 1024;

export interface SendTelegramDeps {
  shopee: MarketplaceAdapter<ShopeeCredentials>;
  awin: MarketplaceAdapter<AwinCredentials>;
  aliexpress?: MarketplaceAdapter<AliexpressCredentials>;
  now?: () => Date;
  getTagAdapter?: typeof getTagAdapter;
  makeClient?: (token: string) => TelegramClient;
}

export async function sendTelegram(deps: SendTelegramDeps, job: SendTelegramJob): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const resolveTagAdapter = deps.getTagAdapter ?? getTagAdapter;
  const makeClient = deps.makeClient ?? ((token: string) => new TelegramClient(token));

  const [bot, template, settingsRows] = await Promise.all([
    prisma.telegramBot.findUnique({ where: { id: job.botId } }),
    prisma.template.findUnique({ where: { id: job.templateId } }),
    prisma.setting.findMany({ where: { tenantId: job.tenantId } }),
  ]);
  if (!bot || !template) return;
  if (bot.tenantId !== job.tenantId || template.tenantId !== job.tenantId) {
    log.warn(
      { botId: job.botId, templateId: job.templateId, tenantId: job.tenantId },
      'bot ou template não pertence ao tenant do job; envio ignorado',
    );
    return;
  }
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value])) as Record<
    string,
    unknown
  >;
  const subIdPattern = String(settings.subIdPattern ?? '{yyyyMMdd}-{batchId}');
  const { token } = decryptJson<{ token: string }>(Buffer.from(bot.encryptedToken));
  const client = makeClient(token);
  const t = now();

  try {
    let text: string;
    let imageUrl: string | undefined;

    if (job.couponId) {
      const coupon = await prisma.coupon.findUnique({ where: { id: job.couponId } });
      if (!coupon) return;
      const elig = isEligibleCoupon({
        code: coupon.code,
        expiresAt: coupon.expiresAt?.toISOString() ?? null,
      });
      if (!elig.ok) return;
      text = renderCouponTemplate(
        template.body,
        {
          store: coupon.store,
          code: coupon.code,
          description: coupon.description,
          expiresAt: coupon.expiresAt?.toISOString() ?? null,
        },
        { now: t.toISOString() },
      );
    } else if (job.productId) {
      const product = await prisma.product.findUnique({ where: { id: job.productId } });
      if (!product) return;
      const conn =
        product.source !== 'MANUAL'
          ? await prisma.marketplaceConnection.findFirst({
              where: { tenantId: job.tenantId, kind: product.source },
            })
          : null;
      let affiliateLink = product.originalUrl;
      if (product.source === 'SHOPEE' && conn?.encryptedCredentials) {
        const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
        const subId = generateSubId(subIdPattern, { now: t, batchId: job.botId });
        affiliateLink = await deps.shopee.toAffiliateLink(creds, product.originalUrl, subId);
      } else if (product.source === 'AWIN' && conn?.encryptedCredentials) {
        const creds = decryptJson<AwinCredentials>(Buffer.from(conn.encryptedCredentials));
        const subId = generateSubId(subIdPattern, { now: t, batchId: job.botId });
        try {
          affiliateLink = await deps.awin.toAffiliateLink(creds, product.originalUrl, subId);
        } catch (err) {
          log.warn(
            { botId: job.botId, err },
            'falha ao gerar link de afiliado da Awin; usando link original',
          );
        }
      } else if (product.source === 'ALIEXPRESS' && conn?.encryptedCredentials) {
        const creds = decryptJson<AliexpressCredentials>(Buffer.from(conn.encryptedCredentials));
        const subId = generateSubId(subIdPattern, { now: t, batchId: job.botId });
        try {
          const adapter = deps.aliexpress ?? getAliexpressAdapter();
          affiliateLink = await adapter.toAffiliateLink(creds, product.originalUrl, subId);
        } catch (err) {
          log.warn(
            { botId: job.botId, err },
            'falha ao gerar link de afiliado do AliExpress; usando link original',
          );
        }
      } else if (
        product.source !== 'SHOPEE' &&
        product.source !== 'AWIN' &&
        product.source !== 'ALIEXPRESS' &&
        product.source !== 'MANUAL' &&
        conn?.encryptedCredentials
      ) {
        const creds = decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials));
        try {
          affiliateLink = await resolveTagAdapter(product.source).toAffiliateLink(
            creds,
            product.originalUrl,
          );
        } catch (err) {
          log.warn(
            { botId: job.botId, source: product.source, err },
            'falha ao gerar link de afiliado; usando link original',
          );
        }
      }
      const pd: ProductData = {
        source: product.source,
        title: product.title,
        price: Number(product.price),
        images: product.images,
        shipping: product.shipping,
        originalUrl: product.originalUrl,
        raw: product.raw,
        ...(product.externalId ? { externalId: product.externalId } : {}),
        ...(product.originalPrice !== null ? { originalPrice: Number(product.originalPrice) } : {}),
        ...(product.discountPct !== null ? { discountPct: product.discountPct } : {}),
        ...(product.salesCount !== null ? { salesCount: product.salesCount } : {}),
        ...(product.commissionPct !== null ? { commissionPct: Number(product.commissionPct) } : {}),
        ...(product.flashSaleEndsAt
          ? { flashSaleEndsAt: product.flashSaleEndsAt.toISOString() }
          : {}),
        ...(product.couponCode ? { couponCode: product.couponCode } : {}),
        ...(product.couponValue !== null ? { couponValue: Number(product.couponValue) } : {}),
      };
      text = renderTemplate(template.body, pd, {
        affiliateLink,
        now: t.toISOString(),
        ...(job.cta ? { cta: job.cta } : {}),
      });
      imageUrl = product.images[0];
    } else if (job.customText) {
      text = job.customText;
      imageUrl = job.customImageUrl;
    } else {
      return;
    }

    let imageBuffer: Buffer | undefined;
    let imageMime = 'image/jpeg';
    if (job.customImageItemId) {
      const item = await prisma.batchItem.findUnique({
        where: { id: job.customImageItemId },
        include: { batch: { select: { tenantId: true } } },
      });
      if (!item) {
        log.warn(
          { customImageItemId: job.customImageItemId, botId: job.botId, chatId: job.chatId },
          'item da imagem customizada não encontrado; envio de foto ignorado',
        );
      } else if (item.batch.tenantId !== job.tenantId) {
        log.warn(
          {
            customImageItemId: job.customImageItemId,
            botId: job.botId,
            chatId: job.chatId,
            tenantId: job.tenantId,
          },
          'item da imagem customizada pertence a outro tenant; upload ignorado',
        );
      } else if (!item.customImageData) {
        log.warn(
          { customImageItemId: job.customImageItemId, botId: job.botId, chatId: job.chatId },
          'item da imagem customizada sem bytes; envio de foto ignorado',
        );
      } else {
        imageBuffer = Buffer.from(item.customImageData);
        imageMime = item.customImageType ?? 'image/jpeg';
      }
    }

    const html = whatsappToTelegramHtml(text);
    // O Telegram rejeita legenda de foto acima de 1024 caracteres: manda a foto sem legenda e o texto depois.
    let result: { messageId: number };
    if (imageBuffer) {
      if (html.length > TELEGRAM_CAPTION_MAX) {
        await client.sendPhotoBuffer(job.chatId, imageBuffer, imageMime);
        result = await client.sendMessage(job.chatId, html);
      } else {
        result = await client.sendPhotoBuffer(job.chatId, imageBuffer, imageMime, html);
      }
    } else if (imageUrl && html.length > TELEGRAM_CAPTION_MAX) {
      await client.sendPhoto(job.chatId, imageUrl);
      result = await client.sendMessage(job.chatId, html);
    } else if (imageUrl) {
      result = await client.sendPhoto(job.chatId, imageUrl, html);
    } else {
      result = await client.sendMessage(job.chatId, html);
    }
    log.info(
      { botId: job.botId, chatId: job.chatId, messageId: result.messageId },
      'oferta enviada no telegram',
    );
  } catch (e) {
    log.warn(
      { botId: job.botId, chatId: job.chatId, err: e instanceof Error ? e.message : String(e) },
      'falha ao enviar no telegram',
    );
  }
}

export function processSendTelegram(deps: SendTelegramDeps) {
  return async (job: Job<SendTelegramJob>) => sendTelegram(deps, job.data);
}
