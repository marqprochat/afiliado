import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';
import type { PublishOfferFn } from '../src/lib/publish-offer';

let tenantId: string;
let botId: string;
let templateId: string;
let productId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'tg-site-links' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
    },
  });
  botId = (
    await prisma.telegramBot.create({
      data: { tenantId, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    })
  ).id;
  templateId = (
    await prisma.template.create({ data: { tenantId, name: 't', body: '{titulo} {link}' } })
  ).id;
  productId = (
    await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        externalId: '7',
        title: 'Mouse',
        price: 30,
        images: ['https://img/m.jpg'],
        originalUrl: 'https://shopee.com.br/product/7/7',
        raw: {},
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

function makeDeps(publishOffer: PublishOfferFn) {
  const sendPhoto = vi.fn(async () => ({ messageId: 2 }));
  const deps: SendTelegramDeps = {
    shopee: {
      ...createShopeeAdapter({ mock: true }),
      toAffiliateLink: async () => 'https://s.shopee.com.br/AFF7',
    },
    awin: createAwinAdapter(),
    now: () => new Date('2026-11-23T12:00:00-03:00'),
    publishOffer,
    makeClient: () =>
      ({
        sendMessage: vi.fn(async () => ({ messageId: 1 })),
        sendPhoto,
      }) as unknown as TelegramClient,
  };
  return { deps, sendPhoto };
}

const job = () => ({ tenantId, botId, chatId: '-1', templateId, productId });

describe('sendTelegram com link do site', () => {
  it('usa a página do site quando a publicação devolve uma URL', async () => {
    const publish = vi.fn<PublishOfferFn>(async () => 'https://site.test/ofertas/mouse-ab12');
    const { deps, sendPhoto } = makeDeps(publish);
    await sendTelegram(deps, job());
    expect(publish).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ title: 'Mouse' }),
      'https://s.shopee.com.br/AFF7',
    );
    expect(sendPhoto).toHaveBeenCalledWith(
      '-1',
      'https://img/m.jpg',
      expect.stringContaining('https://site.test/ofertas/mouse-ab12'),
    );
  });

  it('sem página publicada, mantém o link de afiliado', async () => {
    const { deps, sendPhoto } = makeDeps(async () => null);
    await sendTelegram(deps, job());
    expect(sendPhoto).toHaveBeenCalledWith(
      '-1',
      'https://img/m.jpg',
      expect.stringContaining('https://s.shopee.com.br/AFF7'),
    );
  });
});
