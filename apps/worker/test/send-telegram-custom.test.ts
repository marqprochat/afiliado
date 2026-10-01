import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';

let tenantId: string;
let botId: string;
let templateId: string;
let otherTenantId: string;
let otherBotId: string;

const sendMessage = vi.fn(async () => ({ messageId: 1 }));
const sendPhoto = vi.fn(async () => ({ messageId: 2 }));
const deps: SendTelegramDeps = {
  shopee: createShopeeAdapter({ mock: true }),
  awin: createAwinAdapter(),
  makeClient: () => ({ sendMessage, sendPhoto }) as unknown as TelegramClient,
};

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'tg-custom' } })).id;
  botId = (
    await prisma.telegramBot.create({
      data: { tenantId, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    })
  ).id;
  templateId = (await prisma.template.create({ data: { tenantId, name: 't', body: '{link}' } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { name: 'tg-custom-other' } })).id;
  otherBotId = (
    await prisma.telegramBot.create({
      data: {
        tenantId: otherTenantId,
        label: 'O',
        encryptedToken: encryptJson({ token: 'y' }),
        status: 'OK',
      },
    })
  ).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

describe('sendTelegram com texto livre', () => {
  it('envia só texto quando não há imagem', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    await sendTelegram(deps, { tenantId, botId, chatId: '-1', templateId, customText: 'Aviso geral' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0]).toEqual(['-1', expect.stringContaining('Aviso geral')]);
  });

  it('envia foto com legenda quando há customImageUrl', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-1',
      templateId,
      customText: 'Com foto',
      customImageUrl: 'https://img/x.jpg',
    });
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendPhoto.mock.calls[0]).toEqual([
      '-1',
      'https://img/x.jpg',
      expect.stringContaining('Com foto'),
    ]);
  });

  it('legenda acima de 1024 caracteres: foto sem legenda e depois o texto', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    const long = 'x'.repeat(1500);
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-1',
      templateId,
      customText: long,
      customImageUrl: 'https://img/x.jpg',
    });
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendPhoto.mock.calls[0]).toEqual(['-1', 'https://img/x.jpg']);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual(['-1', long]);
  });

  it('legenda de até 1024 caracteres continua indo na foto', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-1',
      templateId,
      customText: 'y'.repeat(1024),
      customImageUrl: 'https://img/x.jpg',
    });
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendPhoto.mock.calls[0]).toEqual(['-1', 'https://img/x.jpg', 'y'.repeat(1024)]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('bot de outro tenant: não envia nada', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId: otherBotId,
      chatId: '-1',
      templateId,
      customText: 'Vazaria',
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendPhoto).not.toHaveBeenCalled();
  });
});
