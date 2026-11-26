import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';
import type { PublishOfferFn } from '../src/lib/publish-offer';
import { memoryShortenerStore } from '../src/lib/awin-short-links';

const CREAD =
  'https://www.awin1.com/cread.php?awinmid=68224&awinaffid=691887&platform=dl&ued=https%3A%2F%2Fwww.drogal.com.br%2Fp';

let tenantId: string;
let botId: string;
let templateId: string;
let productId: string;
let chatId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'tg-awin-curto' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AWIN',
      status: 'OK',
      encryptedCredentials: encryptJson({
        feedListUrl: 'https://ui.awin.com/f',
        feedIds: ['f1'],
        publisherId: '691887',
        offersApiToken: 'tok',
      }),
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
        source: 'AWIN',
        externalId: 'tg-curto',
        title: 'Suplemento',
        price: 30,
        images: [],
        originalUrl: CREAD,
        raw: {},
      },
    })
  ).id;
  chatId = (
    await prisma.telegramChat.create({
      data: { tenantId, botId, chatId: '-9', title: 'Canal', kind: 'channel' },
    })
  ).id;
});

afterEach(async () => {
  await prisma.setting.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

function makeDeps(publishOffer: PublishOfferFn, remaining = 50) {
  const sendMessage = vi.fn(async (_chat: string, _html: string) => ({ messageId: 1 }));
  const generate = vi.fn(async () => ({ url: CREAD, shortUrl: 'https://tidd.ly/tg1' }));
  const getQuota = vi.fn(async () => ({ limit: 50, usage: 50 - remaining, remaining }));
  const deps: SendTelegramDeps = {
    shopee: createShopeeAdapter({ mock: true }),
    awin: createAwinAdapter(),
    now: () => new Date('2026-11-23T12:00:00-03:00'),
    publishOffer,
    makeClient: () => ({ sendMessage }) as unknown as TelegramClient,
    awinShortener: { store: memoryShortenerStore(), generate, getQuota, sleep: async () => undefined },
  };
  return { deps, sendMessage, generate, getQuota };
}

const job = () => ({ tenantId, botId, chatId: '-9', templateId, productId, batchId: 'lote7' });
const sentText = (m: ReturnType<typeof vi.fn>) => (m.mock.calls[0] as [string, string])[1];

describe('sendTelegram: links curtos da Awin', () => {
  it('setting desligado: cread.php do chat, sem chamar a Awin', async () => {
    const { deps, sendMessage, generate } = makeDeps(async () => null);
    await sendTelegram(deps, job());
    expect(sentText(sendMessage)).toContain('https://www.awin1.com/cread.php?');
    expect(generate).not.toHaveBeenCalled();
  });

  it('ligado + cota ok: link curto gerado com o clickref2 do chat', async () => {
    await prisma.setting.create({ data: { tenantId, key: 'awinShortLinks', value: true } });
    const { deps, sendMessage, generate } = makeDeps(async () => null);
    await sendTelegram(deps, job());
    expect(sentText(sendMessage)).toContain('https://tidd.ly/tg1');
    const { trackCode } = await prisma.telegramChat.findUniqueOrThrow({ where: { id: chatId } });
    expect((generate.mock.calls[0] as unknown[])[1]).toMatchObject({
      advertiserId: 68224,
      parameters: { clickref2: trackCode, clickref3: 'lote7' },
    });
  });

  it('ligado + cota esgotada: mantém o link longo', async () => {
    await prisma.setting.create({ data: { tenantId, key: 'awinShortLinks', value: true } });
    const { deps, sendMessage, generate } = makeDeps(async () => null, 0);
    await sendTelegram(deps, job());
    expect(sentText(sendMessage)).toContain('https://www.awin1.com/cread.php?');
    expect(generate).not.toHaveBeenCalled();
  });

  it('link do site nunca é encurtado', async () => {
    await prisma.setting.create({ data: { tenantId, key: 'awinShortLinks', value: true } });
    const { deps, sendMessage, generate, getQuota } = makeDeps(
      async () => 'https://site.test/ofertas/suplemento',
    );
    await sendTelegram(deps, job());
    expect(sentText(sendMessage)).toContain('https://site.test/ofertas/suplemento');
    expect(generate).not.toHaveBeenCalled();
    expect(getQuota).not.toHaveBeenCalled();
  });
});
