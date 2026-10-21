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

    // Primeira iteração retorna a mensagem; na segunda o bot é finalizado
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

    // Verifica que enviou mensagem de não autorizado com o ID do usuário
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '999999',
      expect.stringContaining('Acesso não autorizado'),
    );
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '999999',
      expect.stringContaining('999999'),
    );
    // Não tenta converter
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

    // Simula falha na conversão
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
    // Verifica aviso de falha e encerramento da interação
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
    // Não buscou lotes
    expect(prisma.batch.findMany).not.toHaveBeenCalled();
  });

  it('pergunta em qual lote quer enviar quando o link é convertido com sucesso', async () => {
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
      messageId: 3,
      from: { id: 123456, firstName: 'João' },
      chat: { id: 123456, type: 'private' },
      date: 1700000000,
      text: 'Oferta boa: https://shopee.com.br/item-top',
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 4,
      chatUpdates: [],
      messages: [message],
      callbackQueries: [],
    });

    // Simula sucesso na conversão
    mockConvertOffer.mockResolvedValueOnce({
      originalText: message.text,
      convertedText: 'Oferta boa: https://s.shopee.com.br/afiliado-xyz',
      hasConvertedLink: true,
      detected: {
        links: [{ originalUrl: 'https://shopee.com.br/item-top', affiliateUrl: 'https://s.shopee.com.br/afiliado-xyz', converted: true }],
      },
    });

    // Lotes disponíveis
    vi.mocked(prisma.batch.findMany).mockResolvedValueOnce([
      { id: 'batch-tech', name: 'Lote Tecnologia', status: 'SCHEDULED', items: [{ status: 'PENDING' }] },
      { id: 'batch-geral', name: 'Lote Geral', status: 'RUNNING', items: [] },
    ] as any);

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    // Verifica que perguntou o lote e mandou teclado com as opções
    expect(fakeClient.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('Em qual lote deseja enviar?'),
      expect.objectContaining({
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ text: expect.stringContaining('Lote Tecnologia') }),
            ]),
            expect.arrayContaining([
              expect.objectContaining({ text: expect.stringContaining('Lote Geral') }),
            ]),
            expect.arrayContaining([
              expect.objectContaining({ text: '❌ Cancelar' }),
            ]),
          ]),
        }),
      }),
    );
  });

  it('processa o callback_query do usuário escolhendo o lote e adiciona a oferta', async () => {
    const manager = new TelegramManager({
      makeClient: () => fakeClient as unknown as TelegramClient,
      convertOffer: mockConvertOffer,
      addBatchItem: mockAddBatchItem,
    });

    // Pré-armazena uma sessão pendente
    const sessionKey = '123456:1700000000';
    (manager as any).pendingSessions.set(sessionKey, {
      sessionKey,
      userId: 123456,
      tenantId: 'tenant-1',
      botId: 'bot-1',
      convertedText: 'Oferta convertida final',
      createdAt: Date.now(),
    });

    mockAddBatchItem.mockResolvedValueOnce({
      success: true,
      batchName: 'Lote Tecnologia',
      runAt: new Date('2026-10-20T22:00:00Z'),
      batchStatus: 'SCHEDULED',
    });

    const callbackQuery: TelegramCallbackQuery = {
      id: 'cq_101',
      from: { id: 123456, firstName: 'João' },
      message: { messageId: 88, chat: { id: 123456, type: 'private' } },
      data: `tg_batch:batch-tech:${sessionKey}`,
    };

    fakeClient.getUpdates.mockResolvedValueOnce({
      nextOffset: 5,
      chatUpdates: [],
      messages: [],
      callbackQueries: [callbackQuery],
    });

    const botMock = {
      id: 'bot-1',
      tenantId: 'tenant-1',
      encryptedToken: Buffer.from('token'),
      updatesOffset: 4,
      status: 'OK',
      allowedUserIds: ['123456'],
    };

    vi.mocked(prisma.telegramBot.findUnique)
      .mockResolvedValueOnce(botMock as any)
      .mockResolvedValueOnce(null);

    await (manager as any).pollLoop('bot-1', 'tenant-1', { stopped: false });

    // Verifica que respondeu a callback query
    expect(fakeClient.answerCallbackQuery).toHaveBeenCalledWith('cq_101');

    // Verifica que chamou addBatchItem com o texto convertido
    expect(mockAddBatchItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        batchId: 'batch-tech',
        customText: 'Oferta convertida final',
      }),
    );

    // Confirmação exibida editando a mensagem
    expect(fakeClient.editMessageText).toHaveBeenCalledWith(
      '123456',
      88,
      expect.stringContaining('Promoção adicionada ao lote com sucesso!'),
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
