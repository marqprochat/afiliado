import { describe, it, expect, vi } from 'vitest';
import { TelegramClient, TelegramApiError } from '../src/client';

function fakeFetch(bodies: unknown[]) {
  const queue = [...bodies];
  return vi.fn(async () => new Response(JSON.stringify(queue.shift()), { status: 200 }));
}

describe('TelegramClient', () => {
  it('getMe converte snake_case pra camelCase', async () => {
    const f = fakeFetch([
      { ok: true, result: { id: 1, is_bot: true, username: 'ofertas_bot', first_name: 'Ofertas' } },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    expect(await client.getMe()).toEqual({
      id: 1,
      isBot: true,
      username: 'ofertas_bot',
      firstName: 'Ofertas',
    });
  });

  it('getMe com token inválido lança TelegramApiError com a description da API', async () => {
    const f = fakeFetch([{ ok: false, description: 'Unauthorized' }]);
    const client = new TelegramClient('BAD', f as unknown as typeof fetch);
    await expect(client.getMe()).rejects.toThrow(new TelegramApiError('Unauthorized'));
  });

  it('getUpdates extrai my_chat_member, messages e callbackQueries e avança o offset', async () => {
    const f = fakeFetch([
      {
        ok: true,
        result: [
          {
            update_id: 10,
            message: {
              message_id: 101,
              from: { id: 987, first_name: 'Maria', username: 'maria_tg' },
              chat: { id: 987, type: 'private' },
              date: 1700000000,
              text: 'Confira https://shopee.com.br/item-1',
            },
          },
          {
            update_id: 11,
            my_chat_member: {
              chat: { id: -100123, title: 'Ofertas VIP', type: 'supergroup' },
              new_chat_member: { status: 'administrator' },
            },
          },
          {
            update_id: 12,
            callback_query: {
              id: 'cq_1',
              from: { id: 987, first_name: 'Maria' },
              message: { message_id: 102, chat: { id: 987, type: 'private' }, text: 'Escolha o lote:' },
              data: 'pick_batch:batch_123:session_456',
            },
          },
        ],
      },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    const r = await client.getUpdates(5);
    expect(r.nextOffset).toBe(13);
    expect(r.chatUpdates).toEqual([
      { chatId: '-100123', title: 'Ofertas VIP', kind: 'supergroup', botIsAdmin: true },
    ]);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({
      messageId: 101,
      from: { id: 987, firstName: 'Maria', username: 'maria_tg' },
      text: 'Confira https://shopee.com.br/item-1',
    });
    expect(r.callbackQueries).toHaveLength(1);
    expect(r.callbackQueries[0]).toMatchObject({
      id: 'cq_1',
      from: { id: 987, firstName: 'Maria' },
      data: 'pick_batch:batch_123:session_456',
    });
  });

  it('getUpdates marca botIsAdmin=false quando o bot foi removido', async () => {
    const f = fakeFetch([
      {
        ok: true,
        result: [
          {
            update_id: 1,
            my_chat_member: {
              chat: { id: 42, title: 'Grupo Teste', type: 'group' },
              new_chat_member: { status: 'left' },
            },
          },
        ],
      },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    const r = await client.getUpdates(0);
    expect(r.chatUpdates[0]!.botIsAdmin).toBe(false);
  });

  it('sendMessage com replyMarkup envia inline_keyboard', async () => {
    const f = fakeFetch([{ ok: true, result: { message_id: 77 } }]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    const res = await client.sendMessage('987', 'Escolha o lote:', {
      replyMarkup: {
        inline_keyboard: [[{ text: 'Lote Tech', callback_data: 'pick:lote_1' }]],
      },
    });
    expect(res).toEqual({ messageId: 77 });
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    const body = JSON.parse(calls[0]![1].body as string);
    expect(body.chat_id).toBe('987');
    expect(body.reply_markup.inline_keyboard[0][0].text).toBe('Lote Tech');
  });

  it('editMessageText e answerCallbackQuery funcionam corretamente', async () => {
    const f = fakeFetch([
      { ok: true, result: { message_id: 88 } },
      { ok: true, result: true },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);

    const editRes = await client.editMessageText('987', 88, 'Texto atualizado');
    expect(editRes).toEqual({ messageId: 88 });

    const ansRes = await client.answerCallbackQuery('cq_1', 'Processando...', false);
    expect(ansRes).toBe(true);
  });

  it('getFile retorna detalhes do arquivo', async () => {
    const f = fakeFetch([
      { ok: true, result: { file_id: 'fid_123', file_path: 'photos/file_1.jpg', file_size: 4096 } },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    const info = await client.getFile('fid_123');
    expect(info).toEqual({
      fileId: 'fid_123',
      filePath: 'photos/file_1.jpg',
      fileSize: 4096,
    });
  });

  it('sendMessage e sendPhoto retornam o messageId', async () => {
    const f = fakeFetch([
      { ok: true, result: { message_id: 55 } },
      { ok: true, result: { message_id: 56 } },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    expect(await client.sendMessage('-100123', 'oi')).toEqual({ messageId: 55 });
    expect(await client.sendPhoto('-100123', 'https://x/img.jpg', 'legenda')).toEqual({
      messageId: 56,
    });
  });

  it('sendMessage e sendPhoto (com legenda) enviam parse_mode HTML', async () => {
    const f = fakeFetch([
      { ok: true, result: { message_id: 1 } },
      { ok: true, result: { message_id: 2 } },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    await client.sendMessage('-100123', '<b>oi</b>');
    await client.sendPhoto('-100123', 'https://x/img.jpg', '<b>legenda</b>');
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    const bodies = calls.map(([, init]) => JSON.parse(init.body as string));
    expect(bodies[0]).toMatchObject({ parse_mode: 'HTML' });
    expect(bodies[1]).toMatchObject({ parse_mode: 'HTML' });
  });

  it('sendPhotoBuffer envia FormData multipart com foto, chat_id e legenda opcional', async () => {
    const f = fakeFetch([
      { ok: true, result: { message_id: 99 } },
      { ok: true, result: { message_id: 100 } },
      { ok: true, result: { message_id: 101 } },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    const res1 = await client.sendPhotoBuffer('-100123', buf, 'image/jpeg');
    expect(res1).toEqual({ messageId: 99 });

    const res2 = await client.sendPhotoBuffer('-100123', buf, 'image/png', '<b>foto</b>');
    expect(res2).toEqual({ messageId: 100 });

    const res3 = await client.sendPhotoBuffer('-100123', buf, 'image/webp');
    expect(res3).toEqual({ messageId: 101 });

    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain('/sendPhoto');
    const form1 = calls[0]![1].body as FormData;
    expect(form1).toBeInstanceOf(FormData);
    expect(form1.get('chat_id')).toBe('-100123');
    const photo1 = form1.get('photo') as unknown as { type?: string; name?: string };
    expect(photo1).toBeTruthy();
    expect(photo1.type).toBe('image/jpeg');
    expect(photo1.name).toBe('photo.jpg');

    const form2 = calls[1]![1].body as FormData;
    expect(form2.get('chat_id')).toBe('-100123');
    expect(form2.get('caption')).toBe('<b>foto</b>');
    expect(form2.get('parse_mode')).toBe('HTML');
    const photo2 = form2.get('photo') as unknown as { type?: string; name?: string };
    expect(photo2.type).toBe('image/png');
    expect(photo2.name).toBe('photo.png');

    const form3 = calls[2]![1].body as FormData;
    const photo3 = form3.get('photo') as unknown as { type?: string; name?: string };
    expect(photo3.type).toBe('image/webp');
    expect(photo3.name).toBe('photo.webp');
  });
});
