import { describe, it, expect, vi, afterAll } from 'vitest';
import type { Job } from 'bullmq';
import { prisma, encryptJson } from '@afilados/db';
import { generateSubId } from '@afilados/core';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import type { CouponSyncJob } from '@afilados/shared';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';
import { mirrorMessage } from '../src/processors/mirror-message';
import { importAwinCatalog } from '../src/processors/awin-import';
import { createCouponSyncProcessor } from '../src/processors/coupon-sync';
import type { WhatsAppGateway } from '../src/wa/gateway';

vi.mock('../src/lib/events', () => ({ publishEvent: vi.fn(async () => {}) }));

const NOW = new Date('2026-09-14T12:00:00-03:00');
const created: string[] = [];
afterAll(async () => {
  // afiliados primeiro (Restrict em parentTenantId)
  await prisma.tenant.deleteMany({ where: { id: { in: created }, parentTenantId: { not: null } } });
  await prisma.tenant.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

/** Dono com credenciais de todos os marketplaces + afiliado (com ou sem identificador). */
async function mkPair(
  opts: {
    subIds?: Partial<Record<'SHOPEE' | 'AWIN' | 'ALIEXPRESS' | 'AMAZON', string>>;
    active?: boolean;
  } = {},
) {
  const owner = await prisma.tenant.create({ data: { name: 'aif-owner' } });
  const aff = await prisma.tenant.create({
    data: { name: 'aif-aff', parentTenantId: owner.id, active: opts.active ?? true },
  });
  created.push(owner.id, aff.id);
  const creds = {
    SHOPEE: { appId: 'a', secret: 's' },
    AWIN: { feedListUrl: 'https://ui.awin.com/feedList/x', feedIds: ['f1'] },
    ALIEXPRESS: { appKey: 'k', appSecret: 's', trackingId: 'dono-track' },
    AMAZON: { tag: 'dono-20' },
  } as const;
  for (const [kind, value] of Object.entries(creds)) {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: owner.id,
        kind: kind as 'SHOPEE',
        status: 'OK',
        encryptedCredentials: encryptJson(value),
      },
    });
  }
  for (const [kind, subId] of Object.entries(opts.subIds ?? {})) {
    await prisma.marketplaceConnection.create({
      data: { tenantId: aff.id, kind: kind as 'SHOPEE', subId },
    });
  }
  return { owner, aff };
}

describe('Telegram com afiliado', () => {
  async function run(
    tenantId: string,
    source: 'SHOPEE' | 'AWIN' | 'ALIEXPRESS',
    url: string,
    extra: Partial<SendTelegramDeps> = {},
  ) {
    const bot = await prisma.telegramBot.create({
      data: { tenantId, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    });
    const template = await prisma.template.create({
      data: { tenantId, name: 't', body: '{link}' },
    });
    const product = await prisma.product.create({
      data: {
        tenantId,
        source,
        externalId: '1',
        title: 'P',
        price: 5,
        images: ['https://img/x.jpg'],
        originalUrl: url,
        raw: {},
      },
    });
    const sendMessage = vi.fn(async () => ({ messageId: 1 }));
    const sendPhoto = vi.fn(async () => ({ messageId: 2 }));
    const shopeeLink = vi.fn(async () => 'https://s.shopee.com.br/X');
    const awinLink = vi.fn(async () => 'https://awin/x');
    const aliLink = vi.fn(async () => 'https://s.click.aliexpress.com/e/_x');
    const deps: SendTelegramDeps = {
      shopee: { ...createShopeeAdapter({ mock: true }), toAffiliateLink: shopeeLink },
      awin: { ...createAwinAdapter(), toAffiliateLink: awinLink },
      aliexpress: {
        kind: 'ALIEXPRESS',
        checkConnection: async () => ({ ok: true }),
        fetchByUrls: async () => [],
        toAffiliateLink: aliLink,
      },
      now: () => NOW,
      makeClient: () => ({ sendMessage, sendPhoto }) as unknown as TelegramClient,
      ...extra,
    };
    await sendTelegram(deps, {
      tenantId,
      botId: bot.id,
      chatId: '-1',
      templateId: template.id,
      productId: product.id,
    });
    const pattern = generateSubId('{yyyyMMdd}-{batchId}', { now: NOW, batchId: bot.id });
    return { sendMessage, sendPhoto, shopeeLink, awinLink, aliLink, pattern };
  }

  it('tenant inativo: nada é enviado nem gerado', async () => {
    const { aff } = await mkPair({ subIds: { SHOPEE: 'maria' }, active: false });
    const r = await run(aff.id, 'SHOPEE', 'https://shopee.com.br/product/1/1');
    expect(r.sendMessage).not.toHaveBeenCalled();
    expect(r.sendPhoto).not.toHaveBeenCalled();
    expect(r.shopeeLink).not.toHaveBeenCalled();
  });

  it('Awin: o 3º argumento é o identificador do afiliado', async () => {
    const { aff } = await mkPair({ subIds: { AWIN: 'mariaawin' } });
    const r = await run(aff.id, 'AWIN', 'https://loja.com.br/p/1');
    expect(r.awinLink).toHaveBeenCalledWith(
      expect.objectContaining({ feedIds: ['f1'] }),
      'https://loja.com.br/p/1',
      'mariaawin',
    );
  });

  it('AliExpress: o 3º argumento é o identificador do afiliado', async () => {
    const { aff } = await mkPair({ subIds: { ALIEXPRESS: 'mariaali' } });
    const r = await run(aff.id, 'ALIEXPRESS', 'https://pt.aliexpress.com/item/1.html');
    expect(r.aliLink).toHaveBeenCalledWith(
      expect.objectContaining({ trackingId: 'dono-track' }),
      'https://pt.aliexpress.com/item/1.html',
      'mariaali',
    );
  });

  it('sem identificador: Shopee/Awin/AliExpress caem no padrão data/lote', async () => {
    const { aff } = await mkPair();
    const s = await run(aff.id, 'SHOPEE', 'https://shopee.com.br/product/1/1');
    expect(s.shopeeLink).toHaveBeenCalledWith(expect.anything(), expect.any(String), s.pattern, []);
    const a = await run(aff.id, 'AWIN', 'https://loja.com.br/p/1');
    expect(a.awinLink).toHaveBeenCalledWith(expect.anything(), expect.any(String), a.pattern);
    const l = await run(aff.id, 'ALIEXPRESS', 'https://pt.aliexpress.com/item/1.html');
    expect(l.aliLink).toHaveBeenCalledWith(expect.anything(), expect.any(String), l.pattern);
  });
});

describe('espelhamento com afiliado', () => {
  const gateway = () =>
    ({
      isConnected: vi.fn(() => true),
      sendMessage: vi.fn(async () => ({ messageId: 'wa-1' })),
      downloadMedia: vi.fn(async () => Buffer.from('')),
    }) as unknown as WhatsAppGateway & { sendMessage: ReturnType<typeof vi.fn> };

  async function run(tenantId: string, gw: ReturnType<typeof gateway>, msgId: string) {
    const sess = await prisma.waSession.create({ data: { tenantId, label: 's' } });
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId: sess.id,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    return mirrorMessage(
      { gateway: gw, sleep: async () => {} },
      {
        tenantId,
        ruleId: rule.id,
        sessionId: sess.id,
        sourceJid: 's@g.us',
        msgId,
        message: { message: { conversation: 'Olha: https://www.amazon.com.br/dp/B0ABCDEF12' } },
      },
    );
  }

  it('tenant inativo: skipped e nada é enviado', async () => {
    const { aff } = await mkPair({ subIds: { AMAZON: 'joao-20' }, active: false });
    const gw = gateway();
    expect(await run(aff.id, gw, 'M-off')).toEqual({
      outcome: 'skipped',
      reason: 'tenant-inactive',
    });
    expect(gw.sendMessage).not.toHaveBeenCalled();
  });

  it('sem identificador: usa a tag do dono (comportamento sem afiliado)', async () => {
    const { aff } = await mkPair();
    const gw = gateway();
    expect(await run(aff.id, gw, 'M-fallback')).toEqual({ outcome: 'mirrored', count: 1 });
    expect(gw.sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      't1@g.us',
      expect.objectContaining({
        text: 'Olha: https://www.amazon.com.br/dp/B0ABCDEF12?tag=dono-20',
      }),
      { dedupeEcho: true },
    );
  });
});

describe('jobs já enfileirados com o tenant inativo', () => {
  it('awin-import: devolve [] sem listar nem baixar feeds', async () => {
    const { aff } = await mkPair({ active: false });
    // inativo mas com AWIN própria: o job foi enfileirado antes da desativação
    await prisma.marketplaceConnection.create({
      data: {
        tenantId: aff.id,
        kind: 'AWIN',
        encryptedCredentials: encryptJson({
          feedListUrl: 'https://ui.awin.com/feedList/x',
          feedIds: ['f1'],
        }),
      },
    });
    const listDatafeeds = vi.fn(async () => []);
    const downloadFeed = vi.fn();
    expect(await importAwinCatalog({ listDatafeeds, downloadFeed }, aff.id)).toEqual([]);
    expect(listDatafeeds).not.toHaveBeenCalled();
    expect(downloadFeed).not.toHaveBeenCalled();
  });

  it('coupon-sync: resultado vazio sem chamar AliExpress nem Awin', async () => {
    const { aff } = await mkPair({ active: false });
    const fetchAliexpressPromoCodes = vi.fn(async () => []);
    const listAwinVouchers = vi.fn(async () => []);
    const process = createCouponSyncProcessor({
      fetchAliexpressPromoCodes,
      listAwinVouchers,
      now: () => NOW,
    });
    const res = await process({ data: { tenantId: aff.id } } as Job<CouponSyncJob>);
    expect(res).toEqual([]);
    expect(fetchAliexpressPromoCodes).not.toHaveBeenCalled();
    expect(listAwinVouchers).not.toHaveBeenCalled();
  });

  it('coupon-sync: tenant ativo continua sincronizando (contraste)', async () => {
    const { aff } = await mkPair();
    const fetchAliexpressPromoCodes = vi.fn(async () => []);
    const process = createCouponSyncProcessor({
      fetchAliexpressPromoCodes,
      listAwinVouchers: vi.fn(async () => []),
      now: () => NOW,
    });
    await process({ data: { tenantId: aff.id } } as Job<CouponSyncJob>);
    expect(fetchAliexpressPromoCodes).toHaveBeenCalled();
  });
});
