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
const sendPhotoBuffer = vi.fn(async () => ({ messageId: 3 }));
const deps: SendTelegramDeps = {
  shopee: createShopeeAdapter({ mock: true }),
  awin: createAwinAdapter(),
  makeClient: () => ({ sendMessage, sendPhoto, sendPhotoBuffer }) as unknown as TelegramClient,
};

let customImageItemId: string;
let foreignImageItemId: string;
const sampleBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'tg-custom' } })).id;
  botId = (
    await prisma.telegramBot.create({
      data: { tenantId, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    })
  ).id;
  templateId = (await prisma.template.create({ data: { tenantId, name: 't', body: '{link}' } })).id;

  const sessionId = (
    await prisma.waSession.create({ data: { tenantId, label: 's', status: 'CONNECTED' } })
  ).id;
  const batch = await prisma.batch.create({
    data: {
      tenantId,
      sessionId,
      templateId,
      name: 'Batch Img',
      groupJids: ['g1@g.us'],
      intervalMin: 1,
      items: {
        create: [
          {
            order: 0,
            runAt: new Date(),
            customText: 'Mensagem com upload',
            customImageData: sampleBuffer,
            customImageType: 'image/jpeg',
          },
        ],
      },
    },
    include: { items: true },
  });
  customImageItemId = batch.items[0]!.id;

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
  const otherSessionId = (
    await prisma.waSession.create({ data: { tenantId: otherTenantId, label: 's2', status: 'CONNECTED' } })
  ).id;
  const otherBatch = await prisma.batch.create({
    data: {
      tenantId: otherTenantId,
      sessionId: otherSessionId,
      templateId: (await prisma.template.create({ data: { tenantId: otherTenantId, name: 't2', body: 'x' } })).id,
      name: 'Batch foreign',
      groupJids: ['g2@g.us'],
      intervalMin: 1,
      items: {
        create: [
          {
            order: 0,
            runAt: new Date(),
            customText: 'Foto alheia',
            customImageData: sampleBuffer,
            customImageType: 'image/png',
          },
        ],
      },
    },
    include: { items: true },
  });
  foreignImageItemId = otherBatch.items[0]!.id;
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
    sendPhotoBuffer.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId: otherBotId,
      chatId: '-1',
      templateId,
      customText: 'Vazaria',
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendPhotoBuffer).not.toHaveBeenCalled();
  });

  it('envia foto por sendPhotoBuffer quando há customImageItemId', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    sendPhotoBuffer.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-100123',
      templateId,
      customText: 'Texto com upload',
      customImageItemId,
    });
    expect(sendPhotoBuffer).toHaveBeenCalledTimes(1);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendPhotoBuffer.mock.calls[0]).toEqual([
      '-100123',
      sampleBuffer,
      'image/jpeg',
      expect.stringContaining('Texto com upload'),
    ]);
  });

  it('customImageItemId com legenda > 1024 caracteres: foto sem legenda e depois o texto', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    sendPhotoBuffer.mockClear();
    const long = 'z'.repeat(1200);
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-100123',
      templateId,
      customText: long,
      customImageItemId,
    });
    expect(sendPhotoBuffer).toHaveBeenCalledTimes(1);
    expect(sendPhotoBuffer.mock.calls[0]).toEqual(['-100123', sampleBuffer, 'image/jpeg']);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual(['-100123', long]);
  });

  it('customImageItemId de outro tenant: ignora o anexo de outro tenant e envia apenas texto', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    sendPhotoBuffer.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-100123',
      templateId,
      customText: 'Texto sem imagem alheia',
      customImageItemId: foreignImageItemId,
    });
    expect(sendPhotoBuffer).not.toHaveBeenCalled();
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual(['-100123', expect.stringContaining('Texto sem imagem alheia')]);
  });

  it('customImageItemId inexistente ou sem bytes: envia apenas texto sem quebrar', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    sendPhotoBuffer.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-100123',
      templateId,
      customText: 'Item que nao existe',
      customImageItemId: 'cuid-inexistente',
    });
    expect(sendPhotoBuffer).not.toHaveBeenCalled();
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual(['-100123', expect.stringContaining('Item que nao existe')]);

    // Item sem bytes
    const textOnlyBatch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId: (await prisma.waSession.findFirstOrThrow({ where: { tenantId } })).id,
        templateId,
        name: 'Batch Text Only',
        groupJids: ['g1@g.us'],
        intervalMin: 1,
        items: {
          create: [{ order: 0, runAt: new Date(), customText: 'Apenas texto' }],
        },
      },
      include: { items: true },
    });
    sendMessage.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-100123',
      templateId,
      customText: 'Apenas texto',
      customImageItemId: textOnlyBatch.items[0]!.id,
    });
    expect(sendPhotoBuffer).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]).toEqual(['-100123', expect.stringContaining('Apenas texto')]);
  });
});
