import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@afilados/db';

/**
 * Ciclo de vida do BaileysGateway sem abrir nenhuma conexão real com o WhatsApp:
 * `makeWASocket` é substituído por um socket falso cujo `ev` é um emitter simples.
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
  sendMessage = vi.fn();
  groupFetchAllParticipating = vi.fn();

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
  await prisma.tenant.create({ data: { id: tenantId, name: 'lifecycle-test' } });
  await prisma.waSession.create({ data: { id: sessionId, tenantId, label: 'lifecycle' } });
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

describe('BaileysGateway — ciclo de vida', () => {
  it('connect() concorrente abre um único socket', async () => {
    const gw = new BaileysGateway();
    const a = gw.connect(session(), { mode: 'qr' });
    const b = gw.connect(session(), { mode: 'qr' });
    await Promise.all([a, b]);

    expect(makeWASocket).toHaveBeenCalledTimes(1);
    await gw.stopAll();
  });

  it('modo pair: pede o código uma única vez, no primeiro qr', async () => {
    const gw = new BaileysGateway();
    await gw.connect(session(), { mode: 'pair', phone: '5511999999999' });
    const sock = sockets[0]!;

    sock.emit('connection.update', { qr: 'x' });
    await vi.waitFor(() => expect(sock.requestPairingCode).toHaveBeenCalledTimes(1));
    sock.emit('connection.update', { qr: 'y' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sock.requestPairingCode).toHaveBeenCalledTimes(1);

    const pairEvents = publishEvent.mock.calls.filter(
      (c) => (c as unknown as [string, { type: string }])[1].type === 'wa.pair-code',
    );
    expect(pairEvents).toHaveLength(1);

    const row = await prisma.waSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.pairCode).toBe('ABCD-EFGH');
    expect(row.lastQr).toBeNull();

    await gw.stopAll();
  });

  it('open → conectado; close com loggedOut → LOGGED_OUT sem reconexão', async () => {
    const gw = new BaileysGateway();
    await gw.connect(session(), { mode: 'qr' });
    const sock = sockets[0]!;

    sock.emit('connection.update', { connection: 'open' });
    await vi.waitFor(() => expect(gw.isConnected(sessionId)).toBe(true), { timeout: 10_000 });

    sock.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    await vi.waitFor(
      async () => {
        const row = await prisma.waSession.findUniqueOrThrow({ where: { id: sessionId } });
        expect(row.status).toBe('LOGGED_OUT');
      },
      { timeout: 10_000 },
    );
    await gw.stopAll();
  });

  it('onMessage repassa mensagem de grupo não-própria; ignora fromMe e DM', async () => {
    const gw = new BaileysGateway();
    const received: unknown[] = [];
    gw.onMessage((m) => received.push(m));
    await gw.connect(session(), { mode: 'qr' });
    const sock = sockets[0]!;
    sock.emit('messages.upsert', {
      type: 'notify',
      messages: [
        { key: { remoteJid: 'g1@g.us', fromMe: false, id: 'M1' }, message: { conversation: 'oi' } },
        { key: { remoteJid: 'g1@g.us', fromMe: true, id: 'M2' }, message: { conversation: 'eu' } },
        {
          key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'M3' },
          message: { conversation: 'dm' },
        },
      ],
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ sessionId, sourceJid: 'g1@g.us', msgId: 'M1' });
    await gw.stopAll();
  });
});
