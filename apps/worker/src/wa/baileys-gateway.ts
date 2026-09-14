import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAUrlInfo,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import { prisma, type WaSessionStatus } from '@afilados/db';
import { config } from '../config';
import { publishEvent } from '../lib/events';
import { usePostgresAuthState } from './auth-state';
import type { GroupInfo, OutgoingMessage, WhatsAppGateway } from './gateway';

interface Live {
  sock: WASocket;
  tenantId: string;
  attempt: number;
  stopping: boolean;
  mode: 'qr' | 'pair';
  phone?: string;
}

const log = pino({ name: 'baileys' });

export class BaileysGateway implements WhatsAppGateway {
  private live = new Map<string, Live>();

  isConnected(sessionId: string) {
    return this.live.get(sessionId)?.sock.user !== undefined;
  }

  count() {
    return this.live.size;
  }

  private async setStatus(
    sessionId: string,
    tenantId: string,
    status: WaSessionStatus,
    extra: { phone?: string; lastQr?: string | null; pairCode?: string | null } = {},
  ) {
    await prisma.waSession.update({
      where: { id: sessionId },
      data: { status, lastSeenAt: new Date(), ...extra },
    });
    const ev: Extract<Parameters<typeof publishEvent>[1], { type: 'wa.status' }> = {
      type: 'wa.status',
      sessionId,
      status,
    };
    if (extra.phone) ev.phone = extra.phone;
    await publishEvent(tenantId, ev);
  }

  async connect(
    session: { id: string; tenantId: string },
    opts: { mode: 'qr' | 'pair'; phone?: string },
  ) {
    if (this.live.has(session.id)) return;
    const prev = this.live.get(session.id);
    const attempt = prev?.attempt ?? 0;
    await this.open(session.id, session.tenantId, opts, attempt);
  }

  private async open(
    sessionId: string,
    tenantId: string,
    opts: { mode: 'qr' | 'pair'; phone?: string },
    attempt: number,
  ) {
    const { state, saveCreds, clear } = await usePostgresAuthState(sessionId);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: [config.WA_BROWSER_NAME, 'Chrome', '120.0'],
      logger: log.child({ sessionId }) as never,
      markOnlineOnConnect: false,
    });
    const entry: Live = { sock, tenantId, attempt, stopping: false, mode: opts.mode };
    if (opts.phone) entry.phone = opts.phone;
    this.live.set(sessionId, entry);
    await this.setStatus(sessionId, tenantId, 'CONNECTING');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      if (u.qr && opts.mode === 'qr') {
        await prisma.waSession.update({
          where: { id: sessionId },
          data: { status: 'NEEDS_QR', lastQr: u.qr },
        });
        await publishEvent(tenantId, { type: 'wa.qr', sessionId, qr: u.qr });
        await publishEvent(tenantId, { type: 'wa.status', sessionId, status: 'NEEDS_QR' });
      }
      if (u.connection === 'open') {
        entry.attempt = 0;
        const phone = sock.user?.id.split(':')[0]?.split('@')[0];
        const extra: { phone?: string; lastQr: null; pairCode: null } = {
          lastQr: null,
          pairCode: null,
        };
        if (phone) extra.phone = phone;
        await this.setStatus(sessionId, tenantId, 'CONNECTED', extra);
      }
      if (u.connection === 'close') {
        this.live.delete(sessionId);
        const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (entry.stopping) {
          await this.setStatus(sessionId, tenantId, 'DISCONNECTED');
          return;
        }
        if (code === DisconnectReason.loggedOut) {
          await clear();
          await this.setStatus(sessionId, tenantId, 'LOGGED_OUT', { lastQr: null, pairCode: null });
          return;
        }
        const delay = Math.min(60_000, 2_000 * 2 ** entry.attempt);
        log.warn({ sessionId, code, delay }, 'conexão fechada; reconectando');
        setTimeout(() => {
          this.open(sessionId, tenantId, opts, entry.attempt + 1).catch((e) => log.error(e));
        }, delay);
      }
    });

    if (opts.mode === 'pair' && opts.phone && !state.creds.registered) {
      const phone = opts.phone;
      // Pair code só pode ser pedido depois que o socket abriu o WebSocket
      setTimeout(() => {
        void (async () => {
          try {
            const code = await sock.requestPairingCode(phone);
            await prisma.waSession.update({
              where: { id: sessionId },
              data: { status: 'NEEDS_QR', pairCode: code },
            });
            await publishEvent(tenantId, { type: 'wa.pair-code', sessionId, code });
          } catch (e) {
            log.error(e, 'falha ao pedir pair code');
          }
        })();
      }, 3_000);
    }
  }

  async disconnect(sessionId: string) {
    const l = this.live.get(sessionId);
    if (!l) return;
    l.stopping = true;
    l.sock.end(undefined);
  }

  async logout(sessionId: string) {
    const l = this.live.get(sessionId);
    if (l) {
      l.stopping = true;
      await l.sock.logout().catch(() => undefined);
    }
    const { clear } = await usePostgresAuthState(sessionId);
    await clear();
    const s = await prisma.waSession.findUnique({ where: { id: sessionId } });
    if (s)
      await this.setStatus(sessionId, s.tenantId, 'LOGGED_OUT', { lastQr: null, pairCode: null });
  }

  async sendMessage(sessionId: string, jid: string, msg: OutgoingMessage) {
    const l = this.live.get(sessionId);
    if (!l || !this.isConnected(sessionId)) throw new Error('WA_NOT_CONNECTED');
    const sent =
      msg.kind === 'image'
        ? await l.sock.sendMessage(jid, { image: { url: msg.imageUrl }, caption: msg.caption })
        : await (async () => {
            const jpegThumbnail = await fetchThumbnail(msg.thumbnailUrl);
            const linkPreview: WAUrlInfo = {
              'canonical-url': msg.url,
              'matched-text': msg.url,
              title: msg.title,
              description: msg.description,
            };
            if (jpegThumbnail) linkPreview.jpegThumbnail = jpegThumbnail;
            return l.sock.sendMessage(jid, { text: msg.text, linkPreview });
          })();
    const messageId = sent?.key?.id;
    if (!messageId) throw new Error('Envio sem messageId');
    return { messageId };
  }

  async fetchGroups(sessionId: string): Promise<GroupInfo[]> {
    const l = this.live.get(sessionId);
    if (!l || !this.isConnected(sessionId)) throw new Error('WA_NOT_CONNECTED');
    const me = l.sock.user?.id.split(':')[0] + '@s.whatsapp.net';
    const groups = await l.sock.groupFetchAllParticipating();
    const out: GroupInfo[] = Object.values(groups).map((g) => ({
      jid: g.id,
      name: g.subject,
      kind: g.isCommunity ? 'COMMUNITY' : 'GROUP',
      botIsAdmin: g.participants.some((p) => p.id === me && !!p.admin),
      memberCount: g.participants.length,
    }));
    return out;
  }
}

async function fetchThumbnail(url: string): Promise<Buffer | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    const sharp = (await import('sharp')).default;
    return await sharp(buf).resize(300, 300, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  } catch {
    return undefined;
  }
}
