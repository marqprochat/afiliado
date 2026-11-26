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

describe('sendTelegram: link por chat (atribuição de vendas)', () => {
  it('chat conhecido: link do site leva ?c=<código do chat>&b=<lote> e o código fica gravado', async () => {
    const chat = await prisma.telegramChat.create({
      data: { tenantId, botId, chatId: '-1', title: 'Canal TG', kind: 'channel' },
    });
    const { deps, sendPhoto } = makeDeps(async () => 'https://site.test/ofertas/mouse-ab12');
    await sendTelegram(deps, { ...job(), batchId: 'lote42' });
    const { trackCode } = await prisma.telegramChat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(trackCode).toMatch(/^t[A-Za-z0-9]{5}$/);
    expect(sendPhoto).toHaveBeenCalledWith(
      '-1',
      'https://img/m.jpg',
      expect.stringContaining(`https://site.test/ofertas/mouse-ab12?c=${trackCode}&amp;b=lote42`),
    );
  });

  it('demais lojas sem site: link inalterado mesmo com chat conhecido', async () => {
    const { deps, sendPhoto } = makeDeps(async () => null);
    await sendTelegram(deps, { ...job(), batchId: 'lote42' });
    const caption = (sendPhoto.mock.calls[0] as unknown as [string, string, string])[2];
    expect(caption).toContain('https://s.shopee.com.br/AFF7');
    expect(caption).not.toContain('?c=');
  });
});
