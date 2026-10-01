import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@afilados/db';

/**
 * Testes de `BaileysGateway.sendMessage` sem abrir nenhuma conexão real com o WhatsApp:
 * `makeWASocket` é substituído por um socket falso, seguindo o mesmo padrão de
 * `baileys-lifecycle.test.ts`.
 */
type Handler = (u: unknown) => void;

class FakeSocket {
  handlers = new Map<string, Handler[]>();
  ev = {
    on: (name: string, fn: Handler) => {
      const list = this.handlers.get(name) ?? [];
      list.push(fn);
      this.handlers.set(name, list);
    },
  };
  ws = { isOpen: false, once() {}, off() {} };
  user: undefined = undefined;
  end() {}
  async logout() {}
  requestPairingCode = vi.fn(async () => 'ABCD-EFGH');
  sendMessage = vi.fn(async () => ({ key: { id: 'WAMSG-1' } }));
  groupFetchAllParticipating = vi.fn();
  groupMetadata = vi.fn();

  emit(name: string, u: unknown) {
    for (const fn of this.handlers.get(name) ?? []) fn(u);
  }
}

const sockets: FakeSocket[] = [];
const makeWASocket = vi.fn(() => {
  const s = new FakeSocket();
  sockets.push(s);
  return s;
});

vi.mock('@whiskeysockets/baileys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@whiskeysockets/baileys')>();
  return {
    ...actual,
    default: makeWASocket,
    makeWASocket,
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
    DisconnectReason: { loggedOut: 401 },
    jidNormalizedUser: (s: string) => s,
  };
});

const publishEvent = vi.fn(async () => {});
vi.mock('../src/lib/events', () => ({ publishEvent }));

const { BaileysGateway } = await import('../src/wa/baileys-gateway');

const tenantId = `t-${randomUUID()}`;
const sessionId = `s-${randomUUID()}`;

beforeAll(async () => {
  await prisma.tenant.create({ data: { id: tenantId, name: 'gateway-test' } });
  await prisma.waSession.create({ data: { id: sessionId, tenantId, label: 'gateway' } });
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
});

beforeEach(() => {
  sockets.length = 0;
  makeWASocket.mockClear();
  publishEvent.mockClear();
});

const session = () => ({ id: sessionId, tenantId });

describe('BaileysGateway.sendMessage', () => {
  it('envia mensagem de texto puro', async () => {
    const gw = new BaileysGateway();
    await gw.connect(session(), { mode: 'qr' });
    const sock = sockets[0]!;
    sock.emit('connection.update', { connection: 'open' });
    await vi.waitFor(() => expect(gw.isConnected(sessionId)).toBe(true));

    const result = await gw.sendMessage(sessionId, '5511999999999@s.whatsapp.net', {
      kind: 'text',
      text: 'Oi, isso é um teste',
    });

    expect(result.messageId).toBeTruthy();
    expect(sock.sendMessage).toHaveBeenCalledWith('5511999999999@s.whatsapp.net', {
      text: 'Oi, isso é um teste',
    });

    await gw.stopAll();
  });
});

describe('BaileysGateway.sendMessage com imagem por URL (anti-SSRF)', () => {
  const jid = '5511999999999@s.whatsapp.net';
  const open = async () => {
    const gw = new BaileysGateway();
    await gw.connect(session(), { mode: 'qr' });
    const sock = sockets[sockets.length - 1]!;
    sock.emit('connection.update', { connection: 'open' });
    await vi.waitFor(() => expect(gw.isConnected(sessionId)).toBe(true));
    return { gw, sock };
  };

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://127.0.0.1:8080/x.jpg',
    'http://10.0.0.5/a.jpg',
    'http://localhost/a.jpg',
  ])('URL bloqueada %s: nunca vai ao Baileys como image.url; legenda sai como texto', async (url) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { gw, sock } = await open();
    await gw.sendMessage(sessionId, jid, { kind: 'image', imageUrl: url, caption: 'Legenda' } as never);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const call of sock.sendMessage.mock.calls as unknown[][]) {
      expect(JSON.stringify(call[1])).not.toContain('"url"');
      expect((call[1] as { image?: unknown }).image).toBeUndefined();
    }
    expect(sock.sendMessage).toHaveBeenCalledWith(jid, { text: 'Legenda' });
    fetchSpy.mockRestore();
    await gw.stopAll();
  });

  it('URL pública com download ok usa o buffer', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const { gw, sock } = await open();
    await gw.sendMessage(sessionId, jid, {
      kind: 'image',
      imageUrl: 'http://203.0.113.10/a.jpg',
      caption: 'Legenda',
    } as never);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const arg = (sock.sendMessage.mock.calls as unknown[][])[0]![1] as { image: unknown; caption: string };
    expect(Buffer.isBuffer(arg.image)).toBe(true);
    expect(arg.caption).toBe('Legenda');
    fetchSpy.mockRestore();
    await gw.stopAll();
  });
});

describe('BaileysGateway.onMessage', () => {
  const groupJid = '120363405287806336@g.us';

  const connected = async () => {
    const gw = new BaileysGateway();
    await gw.connect(session(), { mode: 'qr' });
    const sock = sockets[sockets.length - 1]!;
    sock.emit('connection.update', { connection: 'open' });
    await vi.waitFor(() => expect(gw.isConnected(sessionId)).toBe(true));
    return { gw, sock };
  };

  it('entrega mensagem que o próprio dono colou no grupo (fromMe)', async () => {
    const { gw, sock } = await connected();
    const received: string[] = [];
    gw.onMessage((m) => received.push(m.msgId));

    sock.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: groupJid, fromMe: true, id: 'COLADO-PELO-DONO' },
          message: { conversation: 'https://mercadolivre.com.br/p/123' },
        },
      ],
    });

    expect(received).toEqual(['COLADO-PELO-DONO']);
    await gw.stopAll();
  });

  it('ignora o eco das mensagens que o próprio espelhamento enviou (anti-loop)', async () => {
    const { gw, sock } = await connected();
    const received: string[] = [];
    gw.onMessage((m) => received.push(m.msgId));

    const { messageId } = await gw.sendMessage(
      sessionId,
      groupJid,
      { kind: 'text', text: 'oferta espelhada' },
      { dedupeEcho: true },
    );

    sock.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: groupJid, fromMe: true, id: messageId },
          message: { conversation: 'oferta espelhada' },
        },
      ],
    });

    expect(received).toEqual([]);
    await gw.stopAll();
  });

  it('NÃO ignora envio de outra origem (ex.: automação de ofertas) no mesmo grupo', async () => {
    const { gw, sock } = await connected();
    const received: string[] = [];
    gw.onMessage((m) => received.push(m.msgId));

    // Sem dedupeEcho: é a automação de disparo de ofertas enviando pro grupo, não o mirror.
    const { messageId } = await gw.sendMessage(sessionId, groupJid, {
      kind: 'text',
      text: 'oferta automática',
    });

    sock.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: groupJid, fromMe: true, id: messageId },
          message: { conversation: 'oferta automática' },
        },
      ],
    });

    expect(received).toEqual([messageId]);
    await gw.stopAll();
  });
});
