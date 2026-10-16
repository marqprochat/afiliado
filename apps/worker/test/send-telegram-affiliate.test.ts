import { describe, it, expect, vi, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { generateSubId } from '@afilados/core';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';

const owner = await prisma.tenant.create({ data: { name: 'tg-owner' } });
const aff = await prisma.tenant.create({ data: { name: 'tg-aff', parentTenantId: owner.id } });
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: aff.id } });
  await prisma.tenant.deleteMany({ where: { id: owner.id } });
  await prisma.$disconnect();
});

describe('sendTelegram com afiliado', () => {
  it('Shopee usa credencial do dono e subIds [afiliado, padrão]', async () => {
    await prisma.marketplaceConnection.create({
      data: { tenantId: owner.id, kind: 'SHOPEE', encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }) },
    });
    await prisma.marketplaceConnection.create({ data: { tenantId: aff.id, kind: 'SHOPEE', subId: 'maria' } });
    const bot = await prisma.telegramBot.create({
      data: { tenantId: aff.id, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    });
    const template = await prisma.template.create({ data: { tenantId: aff.id, name: 't', body: '{link}' } });
    const product = await prisma.product.create({
      data: { tenantId: aff.id, source: 'SHOPEE', externalId: '1', title: 'P', price: 5,
        images: ['https://img/x.jpg'], originalUrl: 'https://shopee.com.br/product/1/1', raw: {} },
    });
    const toAffiliateLink = vi.fn(async () => 'https://s.shopee.com.br/AFF');
    const deps: SendTelegramDeps = {
      shopee: { ...createShopeeAdapter({ mock: true }), toAffiliateLink },
      awin: createAwinAdapter(),
      now: () => new Date('2026-09-14T12:00:00-03:00'),
      makeClient: () => ({ sendMessage: vi.fn(async () => ({ messageId: 1 })), sendPhoto: vi.fn(async () => ({ messageId: 2 })) }) as unknown as TelegramClient,
    };
    await sendTelegram(deps, { tenantId: aff.id, botId: bot.id, chatId: '-1', templateId: template.id, productId: product.id });
    const pattern = generateSubId('{yyyyMMdd}-{batchId}', { now: new Date('2026-09-14T12:00:00-03:00'), batchId: bot.id });
    expect(toAffiliateLink).toHaveBeenCalledWith(expect.objectContaining({ appId: 'a' }), product.originalUrl, 'maria', [pattern]);
  });
});
