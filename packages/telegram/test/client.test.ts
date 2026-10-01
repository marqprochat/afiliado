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

  it('getUpdates extrai só eventos de my_chat_member e avança o offset', async () => {
    const f = fakeFetch([
      {
        ok: true,
        result: [
          { update_id: 10, message: { text: 'oi' } },
          {
            update_id: 11,
            my_chat_member: {
              chat: { id: -100123, title: 'Ofertas VIP', type: 'supergroup' },
              new_chat_member: { status: 'administrator' },
            },
          },
        ],
      },
    ]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    const r = await client.getUpdates(5);
    expect(r.nextOffset).toBe(12);
    expect(r.chatUpdates).toEqual([
      { chatId: '-100123', title: 'Ofertas VIP', kind: 'supergroup', botIsAdmin: true },
    ]);
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
