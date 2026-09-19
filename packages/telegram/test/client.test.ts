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
    const f = fakeFetch([{ ok: true, result: { message_id: 55 } }, { ok: true, result: { message_id: 56 } }]);
    const client = new TelegramClient('TOKEN', f as unknown as typeof fetch);
    expect(await client.sendMessage('-100123', 'oi')).toEqual({ messageId: 55 });
    expect(await client.sendPhoto('-100123', 'https://x/img.jpg', 'legenda')).toEqual({ messageId: 56 });
  });
});
