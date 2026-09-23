import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
  type WASocket,
  type WAUrlInfo,
  type WAMessage,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import { prisma, type WaSessionStatus } from '@afilados/db';
import { config } from '../config';
import { publishEvent } from '../lib/events';
import { usePostgresAuthState } from './auth-state';
import type {
  GroupDetails,
  GroupInfo,
  IncomingGroupMessage,
  OutgoingMessage,
  WhatsAppGateway,
} from './gateway';

interface Live {
  sock: WASocket;
  tenantId: string;
  attempt: number;
  /** desligamento pedido por nós (disconnect/logout) — não reconecta */
  stopping: boolean;
  /** logout() é o dono da escrita final de LOGGED_OUT; o close handler não mexe */
  loggingOut: boolean;
  /** true só entre `connection: 'open'` e `connection: 'close'` */
  connected: boolean;
  mode: 'qr' | 'pair';
  phone?: string;
  /** o pair code já foi pedido para este socket (uma vez por socket) */
  pairRequested: boolean;
  /** reconexão agendada por este socket (também em `pendingReconnects`) */
  reconnectTimer?: NodeJS.Timeout;
  /** listeners/timers a remover quando o socket morre */
  cleanup: (() => void)[];
  /** resolve quando o `connection.update` de close chega */
  closed: Promise<void>;
  resolveClosed: () => void;
}

const log = pino({ name: 'baileys' });

const VERSION_TTL_MS = 6 * 60 * 60 * 1000;
type WaVersion = Awaited<ReturnType<typeof fetchLatestBaileysVersion>>['version'];
let versionCache: { version: WaVersion; at: number } | undefined;
let versionInflight: Promise<WaVersion> | undefined;

/**
 * `fetchLatestBaileysVersion()` é uma chamada de rede; numa tempestade de reconexão
 * viraria uma requisição externa por tentativa. Cacheia por processo (6h) e, em caso
 * de falha, cai de volta na última versão conhecida.
 */
async function getWaVersion(): Promise<WaVersion> {
  if (versionCache && Date.now() - versionCache.at < VERSION_TTL_MS) return versionCache.version;
  if (!versionInflight) {
    versionInflight = fetchLatestBaileysVersion()
      .then((r) => {
        versionCache = { version: r.version, at: Date.now() };
        return r.version;
      })
      .catch((e: unknown) => {
        log.warn({ err: e }, 'falha ao buscar versão do Baileys');
        if (versionCache) return versionCache.version;
        throw e;
      })
      .finally(() => {
        versionInflight = undefined;
      });
  }
  return versionInflight;
}

export class BaileysGateway implements WhatsAppGateway {
  private live = new Map<string, Live>();
  /** sessões com um `open()` em voo (antes do `live.set`) — evita socket órfão */
  private opening = new Set<string>();
  /** reconexões agendadas, mesmo sem socket vivo no mapa `live` */
  private pendingReconnects = new Map<string, NodeJS.Timeout>();
  private messageHandlers: ((m: IncomingGroupMessage) => void)[] = [];
  /** ids das mensagens enviadas pelo processor de espelhamento, para não reespelhar o próprio eco */
  private dedupedEchoIds = new Set<string>();
  private groupCache = new Map<string, { data: unknown; timestamp: number }>();

  onMessage(handler: (m: IncomingGroupMessage) => void) {
    this.messageHandlers.push(handler);
  }

  async downloadMedia(sessionId: string, message: unknown): Promise<Buffer> {
    const l = this.live.get(sessionId);
    if (!l) throw new Error('WA_NOT_CONNECTED');
    const buf = await downloadMediaMessage(message as WAMessage, 'buffer', {});
    return buf as Buffer;
  }

  isConnected(sessionId: string) {
    return this.live.get(sessionId)?.connected === true;
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

  private cancelReconnect(sessionId: string) {
    const t = this.pendingReconnects.get(sessionId);
    if (t) clearTimeout(t);
    this.pendingReconnects.delete(sessionId);
    const entry = this.live.get(sessionId);
    if (entry?.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      delete entry.reconnectTimer;
    }
  }

  async connect(
    session: { id: string; tenantId: string },
    opts: { mode: 'qr' | 'pair'; phone?: string },
  ) {
    if (this.live.has(session.id) || this.opening.has(session.id)) return;
    // um connect explícito ganha de uma reconexão agendada: cancela e abre agora
    this.cancelReconnect(session.id);
    await this.open(session.id, session.tenantId, opts, 0);
  }

  private async open(
    sessionId: string,
    tenantId: string,
    opts: { mode: 'qr' | 'pair'; phone?: string },
    attempt: number,
  ) {
    // `open()` só entra no mapa `live` depois de dois awaits (auth state + versão);
    // sem esta marca síncrona dois `open()` concorrentes abririam um socket órfão.
    if (this.opening.has(sessionId) || this.live.has(sessionId)) return;
    this.opening.add(sessionId);
    let state: Awaited<ReturnType<typeof usePostgresAuthState>>['state'];
    let saveCreds: Awaited<ReturnType<typeof usePostgresAuthState>>['saveCreds'];
    let clear: Awaited<ReturnType<typeof usePostgresAuthState>>['clear'];
    let sock: WASocket;
    let entry: Live;
    try {
      ({ state, saveCreds, clear } = await usePostgresAuthState(sessionId));
      const version = await getWaVersion();
      const logger = log.child({ sessionId }) as never;
      sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        browser: [config.WA_BROWSER_NAME, 'Chrome', '120.0'],
        logger,
        markOnlineOnConnect: false,
        cachedGroupMetadata: async (jid) => {
          const cached = this.groupCache.get(jid);
          if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
            return cached.data as never;
          }
          return undefined;
        },
        getMessage: async () => undefined,
      });
      let resolveClosed!: () => void;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      entry = {
        sock,
        tenantId,
        attempt,
        stopping: false,
        loggingOut: false,
        connected: false,
        mode: opts.mode,
        pairRequested: false,
        cleanup: [],
        closed,
        resolveClosed,
      };
      if (opts.phone) entry.phone = opts.phone;
      this.live.set(sessionId, entry);
    } finally {
      this.opening.delete(sessionId);
    }
    await this.setStatus(sessionId, tenantId, 'CONNECTING');

    sock.ev.on('groups.update', (updates) => {
      for (const u of updates) {
        if (u.id) this.groupCache.delete(u.id);
      }
    });

    sock.ev.on('group-participants.update', (event) => {
      if (event.id) this.groupCache.delete(event.id);
    });

    sock.ev.on('creds.update', () => {
      void (async () => {
        try {
          await saveCreds();
        } catch (e) {
          log.error({ err: e, sessionId }, 'falha ao salvar creds');
        }
      })();
    });

    sock.ev.on('messages.upsert', ({ type, messages }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid?.endsWith('@g.us') || !msg.key.id) continue;
        // O dono cola as ofertas no grupo de origem pela própria conta conectada, então
        // `fromMe` precisa passar. Só o eco do que o PRÓPRIO ESPELHAMENTO enviou é descartado
        // (via sendMessage(..., { dedupeEcho: true })) — senão a mensagem espelhada, ao cair
        // num grupo que também é origem de outra regra, entraria em loop. Envios de outras
        // origens (ex.: automação de ofertas) não são marcados e por isso continuam elegíveis
        // a serem espelhados normalmente.
        if (msg.key.fromMe && this.dedupedEchoIds.has(msg.key.id)) continue;
        const incoming: IncomingGroupMessage = {
          sessionId,
          sourceJid: remoteJid,
          msgId: msg.key.id,
          message: msg,
        };
        for (const h of this.messageHandlers) h(incoming);
      }
    });

    sock.ev.on('connection.update', (u) => {
      void (async () => {
        try {
          if (u.qr !== undefined) {
            if (opts.mode === 'pair') {
              // O nó `pair-device` só chega depois do handshake Noise terminar
              // (`validateConnection` → `noise.finishInit`). Pedir o pair code antes
              // disso mandaria o IQ em texto puro e ainda setaria `creds.me`, jogando
              // `validateConnection` no ramo de login. Por isso é aqui, não no `ws.open`.
              if (opts.phone && !state.creds.registered && !entry.pairRequested) {
                entry.pairRequested = true;
                await this.requestPairCode(sessionId, tenantId, entry, opts.phone);
              }
            } else if (u.qr) {
              await prisma.waSession.update({
                where: { id: sessionId },
                data: { status: 'NEEDS_QR', lastQr: u.qr },
              });
              await publishEvent(tenantId, { type: 'wa.qr', sessionId, qr: u.qr });
              await publishEvent(tenantId, { type: 'wa.status', sessionId, status: 'NEEDS_QR' });
            }
          }
          if (u.connection === 'open') {
            entry.attempt = 0;
            entry.connected = true;
            const phone = sock.user?.id.split(':')[0]?.split('@')[0];
            const extra: { phone?: string; lastQr: null; pairCode: null } = {
              lastQr: null,
              pairCode: null,
            };
            if (phone) extra.phone = phone;
            await this.setStatus(sessionId, tenantId, 'CONNECTED', extra);
          }
          if (u.connection === 'close') {
            entry.connected = false;
            entry.resolveClosed();
            for (const fn of entry.cleanup.splice(0)) fn();
            // só remove do mapa se ainda formos o socket corrente da sessão
            if (this.live.get(sessionId) === entry) this.live.delete(sessionId);

            // logout() é o dono da escrita final de LOGGED_OUT
            if (entry.loggingOut) return;

            const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
            if (entry.stopping) {
              await this.setStatus(sessionId, tenantId, 'DISCONNECTED');
              return;
            }
            if (code === DisconnectReason.loggedOut) {
              await clear();
              await this.setStatus(sessionId, tenantId, 'LOGGED_OUT', {
                lastQr: null,
                pairCode: null,
              });
              return;
            }
            const delay = Math.min(60_000, 2_000 * 2 ** entry.attempt);
            log.warn({ sessionId, code, delay }, 'conexão fechada; reconectando');
            const nextAttempt = entry.attempt + 1;
            const timer = setTimeout(() => {
              this.pendingReconnects.delete(sessionId);
              delete entry.reconnectTimer;
              // outro socket já foi aberto (ou está abrindo) para esta sessão
              if (this.live.has(sessionId) || this.opening.has(sessionId)) return;
              this.open(sessionId, tenantId, opts, nextAttempt).catch((e: unknown) =>
                log.error({ err: e, sessionId }, 'falha ao reconectar'),
              );
            }, delay);
            this.pendingReconnects.set(sessionId, timer);
            entry.reconnectTimer = timer;
          }
        } catch (e) {
          log.error({ err: e, sessionId }, 'erro no handler connection.update');
        }
      })();
    });
  }

  private async requestPairCode(
    sessionId: string,
    tenantId: string,
    entry: Live,
    phone: string,
  ): Promise<void> {
    try {
      const code = await entry.sock.requestPairingCode(phone);
      await prisma.waSession.update({
        where: { id: sessionId },
        data: { status: 'NEEDS_QR', pairCode: code },
      });
      await publishEvent(tenantId, { type: 'wa.pair-code', sessionId, code });
      await publishEvent(tenantId, { type: 'wa.status', sessionId, status: 'NEEDS_QR' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error({ err: e, sessionId }, 'falha ao pedir pair code');
      try {
        await this.setStatus(sessionId, tenantId, 'DISCONNECTED');
      } catch (e2) {
        log.error({ err: e2, sessionId }, 'falha ao marcar DISCONNECTED após pair code');
      }
      await publishEvent(tenantId, {
        type: 'error',
        code: 'WA_PAIR_CODE_FAILED',
        message,
      });
    }
  }

  async disconnect(sessionId: string) {
    this.cancelReconnect(sessionId);
    const l = this.live.get(sessionId);
    if (!l) return;
    l.stopping = true;
    for (const fn of l.cleanup.splice(0)) fn();
    l.sock.end(undefined);
  }

  /** Encerra todas as sessões vivas e cancela toda reconexão pendente. */
  async stopAll() {
    for (const t of this.pendingReconnects.values()) clearTimeout(t);
    this.pendingReconnects.clear();
    for (const sessionId of [...this.live.keys()]) {
      await this.disconnect(sessionId);
    }
  }

  async logout(sessionId: string) {
    this.cancelReconnect(sessionId);
    const l = this.live.get(sessionId);
    if (l) {
      l.stopping = true;
      l.loggingOut = true;
      for (const fn of l.cleanup.splice(0)) fn();
      try {
        await l.sock.logout();
      } catch (e) {
        log.warn({ err: e, sessionId }, 'falha no logout remoto; encerrando socket');
      }
      l.sock.end(undefined);
      // espera o socket realmente fechar antes de escrever o status final
      let guard: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          l.closed,
          new Promise<void>((resolve) => {
            guard = setTimeout(resolve, 10_000);
            guard.unref?.();
          }),
        ]);
      } finally {
        if (guard) clearTimeout(guard);
      }
      if (this.live.get(sessionId) === l) this.live.delete(sessionId);
    }
    const { clear } = await usePostgresAuthState(sessionId);
    await clear();
    const s = await prisma.waSession.findUnique({ where: { id: sessionId } });
    if (s)
      await this.setStatus(sessionId, s.tenantId, 'LOGGED_OUT', { lastQr: null, pairCode: null });
  }

  async sendMessage(
    sessionId: string,
    jid: string,
    msg: OutgoingMessage,
    opts?: { dedupeEcho?: boolean },
  ) {
    const l = this.live.get(sessionId);
    if (!l || !this.isConnected(sessionId)) throw new Error('WA_NOT_CONNECTED');

    // Se for grupo, pré-carrega ou garante metadados para estabelecer sessões dos participantes
    if (jid.endsWith('@g.us')) {
      try {
        if (!this.groupCache.has(jid)) {
          const meta = await l.sock.groupMetadata(jid);
          this.groupCache.set(jid, { data: meta, timestamp: Date.now() });
        }
      } catch (err) {
        log.warn({ err, sessionId, jid }, 'aviso ao obter metadados do grupo');
      }
    }

    // Prepara buffer de imagem com headers adequados para evitar 404 de CDN
    let imageBuf = msg.kind === 'image' ? msg.imageBuffer : undefined;
    if (msg.kind === 'image' && !imageBuf && msg.imageUrl) {
      imageBuf = await fetchMediaBuffer(msg.imageUrl);
    }

    const doSend = async (asPreviewFallback = false) => {
      if (msg.kind === 'image') {
        if (imageBuf && !asPreviewFallback) {
          return l.sock.sendMessage(jid, {
            image: imageBuf,
            caption: msg.caption,
          });
        } else if (!imageBuf && !asPreviewFallback && msg.imageUrl) {
          try {
            return await l.sock.sendMessage(jid, {
              image: { url: msg.imageUrl },
              caption: msg.caption,
            });
          } catch (err) {
            // Fallback para envio em formato texto caso o download da imagem falhe
            log.warn(
              { sessionId, jid, imageUrl: msg.imageUrl, err },
              'falha ao anexar imagem por URL; enviando em modo texto',
            );
            return l.sock.sendMessage(jid, { text: msg.caption });
          }
        } else {
          return l.sock.sendMessage(jid, { text: msg.caption });
        }
      } else if (msg.kind === 'preview') {
        const jpegThumbnail = await fetchThumbnail(msg.thumbnailUrl);
        const linkPreview: WAUrlInfo = {
          'canonical-url': msg.url,
          'matched-text': msg.url,
          title: msg.title,
          description: msg.description,
        };
        if (jpegThumbnail) linkPreview.jpegThumbnail = jpegThumbnail;
        return l.sock.sendMessage(jid, { text: msg.text, linkPreview });
      } else {
        return l.sock.sendMessage(jid, { text: msg.text });
      }
    };

    let sent;
    try {
      sent = await doSend();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isSessionError = /No sessions|SessionError|invalid session|PreKey/i.test(errMsg);
      const is404 = /404|status code 404/i.test(errMsg);

      if (isSessionError && jid.endsWith('@g.us')) {
        log.warn({ sessionId, jid, errMsg }, 'erro de sessão no grupo; limpando chaves de sender-key e re-obtendo metadados');
        this.groupCache.delete(jid);
        try {
          await prisma.waAuthKey.deleteMany({
            where: { sessionId, type: { in: ['sender-key', 'sender-key-memory'] } },
          });
          const freshMeta = await l.sock.groupMetadata(jid);
          this.groupCache.set(jid, { data: freshMeta, timestamp: Date.now() });
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
        sent = await doSend(false).catch(() => doSend(true));
      } else if (is404 && msg.kind === 'image') {
        log.warn({ sessionId, jid, errMsg }, 'falha 404 na imagem; tentando envio em modo texto');
        sent = await doSend(true);
      } else {
        throw err;
      }
    }

    const messageId = sent?.key?.id;
    if (!messageId) throw new Error('Envio sem messageId');
    if (opts?.dedupeEcho) {
      if (this.dedupedEchoIds.size >= 5000) {
        this.dedupedEchoIds.delete(this.dedupedEchoIds.values().next().value!);
      }
      this.dedupedEchoIds.add(messageId);
    }
    return { messageId };
  }

  async fetchGroups(sessionId: string): Promise<GroupInfo[]> {
    const l = this.live.get(sessionId);
    if (!l || !this.isConnected(sessionId)) throw new Error('WA_NOT_CONNECTED');
    if (!l.sock.user) throw new Error('WA_NOT_CONNECTED');
    // O WhatsApp entrega o LID da própria conta só algum tempo depois da conexão abrir (numa
    // sessão recém-pareada pode demorar bastante). Como os grupos hoje identificam admins
    // exclusivamente por LID, sincronizar sem ele marcaria TODOS os grupos como não-admin —
    // dado errado gravado silenciosamente. Espera, e se não vier, falha em vez de gravar.
    for (let i = 0; i < 30 && !l.sock.user?.lid; i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const user = l.sock.user;
    if (!user) throw new Error('WA_NOT_CONNECTED');
    if (!user.lid) throw new Error('WA_LID_PENDING');
    // a conta aparece nos participantes ora com o JID de telefone, ora com o LID
    const meJid = jidNormalizedUser(user.id);
    const meLid = user.lid ? jidNormalizedUser(user.lid) : undefined;
    const isMe = (...ids: (string | undefined)[]) =>
      ids.some((id) => {
        if (!id) return false;
        const n = jidNormalizedUser(id);
        return n === meJid || (meLid !== undefined && n === meLid);
      });
    const groups = await l.sock.groupFetchAllParticipating();
    const out: GroupInfo[] = Object.values(groups).map((g) => ({
      jid: g.id,
      name: g.subject,
      kind: g.isCommunity ? 'COMMUNITY' : 'GROUP',
      botIsAdmin: g.participants.some((p) => isMe(p.id, p.lid) && !!p.admin),
      memberCount: g.participants.length,
    }));
    return out;
  }

  private liveOrThrow(sessionId: string) {
    const l = this.live.get(sessionId);
    if (!l || !this.isConnected(sessionId)) throw new Error('WA_NOT_CONNECTED');
    return l;
  }

  private toJids(phones: string[]) {
    return phones.map((p) => `${p.replace(/\D/g, '')}@s.whatsapp.net`);
  }

  async createGroup(
    sessionId: string,
    subject: string,
    participantPhones: string[],
  ): Promise<{ jid: string }> {
    const l = this.liveOrThrow(sessionId);
    const meta = await l.sock.groupCreate(subject, this.toJids(participantPhones));
    return { jid: meta.id };
  }

  async updateGroupParticipants(
    sessionId: string,
    jid: string,
    action: 'add' | 'remove' | 'promote' | 'demote',
    participantPhones: string[],
  ): Promise<void> {
    const l = this.liveOrThrow(sessionId);
    await l.sock.groupParticipantsUpdate(jid, this.toJids(participantPhones), action);
    this.groupCache.delete(jid);
  }

  async updateGroupSettings(
    sessionId: string,
    jid: string,
    settings: { subject?: string; description?: string; announceOnly?: boolean },
  ): Promise<void> {
    const l = this.liveOrThrow(sessionId);
    if (settings.subject !== undefined) await l.sock.groupUpdateSubject(jid, settings.subject);
    if (settings.description !== undefined) {
      await l.sock.groupUpdateDescription(jid, settings.description);
    }
    if (settings.announceOnly !== undefined) {
      await l.sock.groupSettingUpdate(jid, settings.announceOnly ? 'announcement' : 'not_announcement');
    }
    this.groupCache.delete(jid);
  }

  async getInviteCode(sessionId: string, jid: string, revoke = false): Promise<string> {
    const l = this.liveOrThrow(sessionId);
    const code = revoke ? await l.sock.groupRevokeInvite(jid) : await l.sock.groupInviteCode(jid);
    if (!code) throw new Error('link de convite indisponível');
    return code;
  }

  async getGroupDetails(sessionId: string, jid: string): Promise<GroupDetails> {
    const l = this.liveOrThrow(sessionId);
    const meta = await l.sock.groupMetadata(jid);
    let inviteCode: string | null = null;
    try {
      inviteCode = (await l.sock.groupInviteCode(jid)) ?? null;
    } catch {
      // sem permissão (ex.: bot não é admin) — segue sem o link
    }
    return {
      jid: meta.id,
      subject: meta.subject,
      description: meta.desc ?? null,
      announceOnly: !!meta.announce,
      inviteCode,
      participants: meta.participants.map((p) => ({ jid: p.id, admin: p.admin ?? null })),
    };
  }
}

async function fetchMediaBuffer(url?: string): Promise<Buffer | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) return undefined;
    const ab = await res.arrayBuffer();
    const rawBuf = Buffer.from(ab);
    try {
      const sharp = (await import('sharp')).default;
      return await sharp(rawBuf).jpeg({ quality: 85 }).toBuffer();
    } catch {
      return rawBuf;
    }
  } catch {
    return undefined;
  }
}

async function fetchThumbnail(url: string): Promise<Buffer | undefined> {
  try {
    const buf = await fetchMediaBuffer(url);
    if (!buf) return undefined;
    const sharp = (await import('sharp')).default;
    return await sharp(buf).resize(300, 300, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  } catch {
    return undefined;
  }
}
