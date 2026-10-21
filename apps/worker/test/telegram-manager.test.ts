import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramManager } from '../src/telegram/manager';
import { TelegramClient, type TelegramMessage, type TelegramCallbackQuery } from '@afilados/telegram';
import { prisma } from '@afilados/db';

vi.mock('@afilados/db', () => ({
  prisma: {
    telegramBot: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    telegramChat: {
      upsert: vi.fn(),
    },
    batch: {
      findMany: vi.fn(),
    },
    product: {
      create: vi.fn(),
    },
    $transaction: vi.fn((items) => Promise.resolve(items)),
  },
  decryptJson: vi.fn(() => ({ token: 'mock-bot-token' })),
}));

vi.mock('../src/lib/events', () => ({
  publishEvent: vi.fn(),
}));

describe('TelegramManager', () => {
  let fakeClient: {
    getUpdates: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    answerCallbackQuery: ReturnType<typeof vi.fn>;
    getFile: ReturnType<typeof vi.fn>;
    downloadFile: ReturnType<typeof vi.fn>;
  };
  let mockConvertOffer: ReturnType<typeof vi.fn>;
  let mockAddBatchItem: ReturnType<typeof vi.fn>;
  let mockFetchProduct: ReturnType<typeof vi.fn>;
  let mockDownloadImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    fakeClient = {
      getUpdates: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue({ messageId: 100 }),
      editMessageText: vi.fn().mockResolvedValue({ messageId: 100 }),
      answerCallbackQuery: vi.fn().mockResolvedValue(true),
      getFile: vi.fn().mockResolvedValue({ fileId: 'f1', filePath: 'photos/f1.jpg' }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    };

    mockConvertOffer = vi.fn();
    mockAddBatchItem = vi.fn();
    mockFetchProduct = vi.fn();
    mockDownloadImage = vi.fn();
  });

  it('bloqueia usuário cujo ID não está na lista allowedUserIds', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
    });

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 0,
      status: 'OK',
      allowedUserIds: ['123456'], // Usuário 999999 NÃO está na lista
    };

    const message: TelegramMessage = {
      messageId: 1,
      from: { id: 999999, firstName: 'Estranho' },
      chat: { id: 999999, type: 'private' },
      date: 1700000000,
      text: 'Olha essa promo https://shopee.com.br/item',
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 2,
      chatUpdates: [],
      messages: [message],
      callbackQueries: [],
    });

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '999999',
      expect.stringContaining('Acesso não autorizado'),
    );
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '999999',
      expect.stringContaining('999999'),
    );
    expect(mockConvertOffer).not.toHaveBeenCalled();
  });

  it('avisa e finaliza quando não consegue converter o link', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
    });

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 0,
      status: 'OK',
      allowedUserIds: ['123456'],
    };

    const message: TelegramMessage = {
      messageId: 2,
      from: { id: 123456, firstName: 'João' },
      chat: { id: 123456, type: 'private' },
      date: 1700000000,
      text: 'Promoção https://linkinvalido.com/algo',
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 3,
      chatUpdates: [],
      messages: [message],
      callbackQueries: [],
    });

    mockConvertOffer.mockResolvedValueOnce({
      originalText: message.text,
      convertedText: message.text,
      hasConvertedLink: false,
      failureReason: 'Link não reconhecido como marketplace suportado',
      detected: { links: [] },
    });

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    expect(mockConvertOffer).toHaveBeenCalledWith('tenant-1', message.text);
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Não foi possível converter o link da promoção'),
    );
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Link não reconhecido como marketplace suportado'),
    );
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('A interação foi finalizada'),
    );
    expect(prisma.batch.findMany).not.toHaveBeenCalled();
  });

  it('se enviar colagem com texto longo, pergunta em qual lote quer enviar', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
      fetchProduct: mockFetchProduct.mockResolvedValue(null),
    });

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 0,
      status: 'OK',
      allowedUserIds: ['123456'],
    };

    // Colagem com texto longo (> 60 caracteres além do link)
    const longText =
      '🔥 OFERTA IMPERDÍVEL DO DIA!\n' +
      'Smartphone Top de Linha com câmera excelente\n' +
      'De R$ 1.999 por R$ 1.299 em até 10x sem juros\n' +
      'Compre agora pelo link: https://shopee.com.br/item-top\n' +
      'Aproveite antes que acabe o estoque!';

    const message: TelegramMessage = {
      messageId: 3,
      from: { id: 123456, firstName: 'João' },
      chat: { id: 123456, type: 'private' },
      date: 1700000000,
      text: longText,
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 4,
      chatUpdates: [],
      messages: [message],
      callbackQueries: [],
    });

    mockConvertOffer.mockResolvedValueOnce({
      originalText: message.text,
      convertedText: longText.replace('https://shopee.com.br/item-top', 'https://s.shopee.com.br/afiliado-xyz'),
      hasConvertedLink: true,
      detected: {
        links: [
          {
            originalUrl: 'https://shopee.com.br/item-top',
            resolvedUrl: 'https://shopee.com.br/item-top',
            affiliateUrl: 'https://s.shopee.com.br/afiliado-xyz',
            marketplace: 'SHOPEE',
            converted: true,
          },
        ],
      },
    });

    vi.mocked(prisma.batch.findMany).mockResolvedValueOnce([
      { id: 'batch-tech', name: 'Lote Tecnologia', status: 'SCHEDULED', items: [{ status: 'PENDING' }] },
      { id: 'batch-geral', name: 'Lote Geral', status: 'RUNNING', items: [] },
    ] as any);

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Em qual lote deseja enviar?'),
      expect.objectContaining({
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ text: expect.stringContaining('Lote Tecnologia') }),
            ]),
          ]),
        }),
      }),
    );
  });

  it('se enviar APENAS UM LINK, busca tudo do produto e pergunta se tem cupom', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
      fetchProduct: mockFetchProduct,
      downloadImage: mockDownloadImage,
    });

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 0,
      status: 'OK',
      allowedUserIds: ['123456'],
    };

    const link = 'https://shopee.com.br/product/123/456';
    const message: TelegramMessage = {
      messageId: 10,
      from: { id: 123456, firstName: 'João' },
      chat: { id: 123456, type: 'private' },
      date: 1700000000,
      text: link,
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 11,
      chatUpdates: [],
      messages: [message],
      callbackQueries: [],
    });

    mockConvertOffer.mockResolvedValueOnce({
      originalText: link,
      convertedText: 'https://s.shopee.com.br/xyz',
      hasConvertedLink: true,
      detected: {
        links: [
          {
            originalUrl: link,
            resolvedUrl: link,
            affiliateUrl: 'https://s.shopee.com.br/xyz',
            marketplace: 'SHOPEE',
            converted: true,
          },
        ],
      },
    });

    mockFetchProduct.mockResolvedValueOnce({
      source: 'SHOPEE',
      title: 'Mouse Gamer RGB 16000 DPI',
      price: 159.9,
      originalPrice: 220.0,
      discountPct: 27,
      images: ['https://cf.shopee.com.br/file/img1.jpg'],
      shipping: 'FREE',
      originalUrl: link,
      raw: {},
    });

    mockDownloadImage.mockResolvedValueOnce(Buffer.from([0xff, 0xd8, 0xff]));

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    // 1. Buscou os dados do produto via adapter
    expect(mockFetchProduct).toHaveBeenCalledWith('tenant-1', 'SHOPEE', link);
    // 2. Baixou a imagem do produto para garantir envio com foto
    expect(mockDownloadImage).toHaveBeenCalledWith('https://cf.shopee.com.br/file/img1.jpg');
    // 3. Perguntou se tem cupom com o botão 'Sem cupom'
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Deseja adicionar algum cupom para esta oferta?'),
      expect.objectContaining({
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ text: '⏭️ Sem cupom' }),
            ]),
            expect.arrayContaining([
              expect.objectContaining({ text: '❌ Cancelar' }),
            ]),
          ]),
        }),
      }),
    );
  });

  it('quando o usuário responde com código de cupom em texto, anota o cupom e mostra lotes', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
    });

    const sessionKey = '123456:1700000000';
    (manager as any).pendingSessions.set(sessionKey, {
      sessionKey,
      userId: 123456,
      tenantId: 'tenant-1',
      botId: 'bot-1',
      step: 'waiting_coupon',
      isLinkOnly: true,
      convertedText: 'https://s.shopee.com.br/xyz',
      originalUrl: 'https://shopee.com.br/product/123/456',
      source: 'SHOPEE',
      productData: {
        source: 'SHOPEE',
        title: 'Mouse Gamer RGB',
        price: 159.9,
        images: [],
        shipping: 'FREE',
        originalUrl: 'https://shopee.com.br/product/123/456',
      },
      createdAt: Date.now(),
    });

    const message: TelegramMessage = {
      messageId: 12,
      from: { id: 123456, firstName: 'João' },
      chat: { id: 123456, type: 'private' },
      date: 1700000005,
      text: 'GAMER20OFF',
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 13,
      chatUpdates: [],
      messages: [message],
      callbackQueries: [],
    });

    vi.mocked(prisma.batch.findMany).mockResolvedValueOnce([
      { id: 'batch-gamer', name: 'Lote Games', status: 'RUNNING', items: [] },
    ] as any);

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 12,
      status: 'OK',
      allowedUserIds: ['123456'],
    };

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    // Anotou o cupom na sessão
    const session = (manager as any).pendingSessions.get(sessionKey);
    expect(session.couponCode).toBe('GAMER20OFF');
    expect(session.step).toBe('choosing_batch');

    // Confirmou o cupom por mensagem e exibiu os lotes
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('GAMER20OFF'),
    );
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Em qual lote deseja enviar?'),
      expect.anything(),
    );
  });

  it('ao selecionar o lote com produto link-only, cria o Produto com cupom e adiciona por productId para respeitar o template', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
    });

    const sessionKey = '123456:1700000000';
    (manager as any).pendingSessions.set(sessionKey, {
      sessionKey,
      userId: 123456,
      tenantId: 'tenant-1',
      botId: 'bot-1',
      step: 'choosing_batch',
      isLinkOnly: true,
      convertedText: 'https://s.shopee.com.br/xyz',
      originalUrl: 'https://shopee.com.br/product/123/456',
      source: 'SHOPEE',
      couponCode: 'CUPOM15',
      imageBuffer: Buffer.from([1, 2, 3]),
      productData: {
        source: 'SHOPEE',
        title: 'Mouse Gamer RGB',
        price: 159.9,
        images: ['https://img.com/mouse.jpg'],
        shipping: 'FREE',
        originalUrl: 'https://shopee.com.br/product/123/456',
      },
      createdAt: Date.now(),
    });

    vi.mocked(prisma.product.create).mockResolvedValueOnce({
      id: 'prod-mouse-999',
      title: 'Mouse Gamer RGB',
    } as any);

    mockAddBatchItem.mockResolvedValueOnce({
      success: true,
      batchName: 'Lote Games',
      runAt: new Date('2026-10-21T18:00:00Z'),
      batchStatus: 'SCHEDULED',
    });

    const callbackQuery: TelegramCallbackQuery = {
      id: 'cq_batch_choice',
      from: { id: 123456, firstName: 'João' },
      message: { messageId: 95, chat: { id: 123456, type: 'private' } },
      data: `tg_batch:batch-gamer:${sessionKey}`,
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 14,
      chatUpdates: [],
      messages: [],
      callbackQueries: [callbackQuery],
    });

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 13,
      status: 'OK',
      allowedUserIds: ['123456'],
    };

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    // Cria o produto no banco com o cupom informado
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          source: 'SHOPEE',
          title: 'Mouse Gamer RGB',
          price: 159.9,
          couponCode: 'CUPOM15',
        }),
      }),
    );

    // Adiciona ao lote com productId (para renderizar o template do lote!)
    expect(mockAddBatchItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        batchId: 'batch-gamer',
        productId: 'prod-mouse-999',
        couponCode: 'CUPOM15',
        imageBuffer: expect.any(Buffer),
      }),
    );

    // Mensagem de confirmação informa que seguirá o template do lote
    expect(fakeClient.editMessageText).toHaveBeenCalledWith(
      '123456',
      95,
      expect.stringContaining('O disparo seguirá rigorosamente o modelo/template do lote'),
    );
  });

  it('processa o cancelamento via callback_query', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
    });

    const sessionKey = '123456:1700000000';
    (manager as any).pendingSessions.set(sessionKey, {
      sessionKey,
      userId: 123456,
      tenantId: 'tenant-1',
      botId: 'bot-1',
      convertedText: 'Oferta cancelada',
      createdAt: Date.now(),
    });

    const callbackQuery: TelegramCallbackQuery = {
      id: 'cq_102',
      from: { id: 123456 },
      message: { messageId: 90, chat: { id: 123456, type: 'private' } },
      data: `tg_cancel:${sessionKey}`,
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 6,
      chatUpdates: [],
      messages: [],
      callbackQueries: [callbackQuery],
    });

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 5,
      status: 'OK',
      allowedUserIds: ['123456'],
    };

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    expect(fakeClient.answerCallbackQuery).toHaveBeenCalledWith('cq_102');
    expect(fakeClient.editMessageText).toHaveBeenCalledWith(
      '123456',
      90,
      expect.stringContaining('Envio cancelado pelo usuário'),
    );
    expect((manager as any).pendingSessions.has(sessionKey)).toBe(false);
  });
});
