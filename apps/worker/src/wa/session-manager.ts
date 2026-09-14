import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import type { WaCommandJob } from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { publishEvent } from '../lib/events';
import type { BaileysGateway } from './baileys-gateway';

const log = pino({ name: 'wa-manager' });
const LOCK_TTL_MS = 30_000;
const LOCK_RENEW_MS = 10_000;

/** só renova se ainda formos o dono do lock */
const RENEW_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
/** só apaga se ainda formos o dono do lock */
const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

const lockKey = (sessionId: string) => `wa:lock:${sessionId}`;

export class WaSessionManager {
  private locks = new Map<string, NodeJS.Timeout>();
  private readonly owner = `worker:${process.pid}:${Math.random().toString(36).slice(2)}`;

  constructor(private readonly gateway: BaileysGateway) {}

  sessionCount() {
    return this.gateway.count();
  }

  async start() {
    const sessions = await prisma.waSession.findMany({
      where: { status: { in: ['CONNECTING', 'NEEDS_QR', 'CONNECTED'] } },
    });
    for (const s of sessions) {
      if (await this.acquireLock(s.id)) {
        await this.gateway.connect({ id: s.id, tenantId: s.tenantId }, { mode: 'qr' });
      }
    }
  }

  async stop() {
    for (const id of [...this.locks.keys()]) {
      try {
        await this.gateway.disconnect(id);
      } catch (e) {
        log.error({ err: e, sessionId: id }, 'falha ao desconectar sessão no stop');
      }
      await this.releaseLock(id);
    }
    this.locks.clear();
  }

  private async acquireLock(sessionId: string): Promise<boolean> {
    const key = lockKey(sessionId);
    const ok = await getRedis().set(key, this.owner, 'PX', LOCK_TTL_MS, 'NX');
    if (ok !== 'OK') {
      const holder = await getRedis().get(key);
      if (holder !== this.owner) return false;
    }
    if (!this.locks.has(sessionId)) {
      const t = setInterval(() => {
        void this.renewLock(sessionId);
      }, LOCK_RENEW_MS);
      this.locks.set(sessionId, t);
    }
    return true;
  }

  /** Compare-and-renew: se perdemos o lock, paramos de dirigir a sessão. */
  private async renewLock(sessionId: string) {
    try {
      const res = await getRedis().eval(
        RENEW_LUA,
        1,
        lockKey(sessionId),
        this.owner,
        String(LOCK_TTL_MS),
      );
      if (Number(res) !== 1) {
        log.warn({ sessionId }, 'lock perdido para outro worker; desconectando sessão');
        const t = this.locks.get(sessionId);
        if (t) clearInterval(t);
        this.locks.delete(sessionId);
        await this.gateway.disconnect(sessionId);
      }
    } catch (e) {
      log.error({ err: e, sessionId }, 'falha ao renovar lock');
    }
  }

  /** Compare-and-delete: nunca apaga o lock de outro worker. */
  private async releaseLock(sessionId: string) {
    const t = this.locks.get(sessionId);
    if (t) clearInterval(t);
    this.locks.delete(sessionId);
    try {
      await getRedis().eval(RELEASE_LUA, 1, lockKey(sessionId), this.owner);
    } catch (e) {
      log.error({ err: e, sessionId }, 'falha ao liberar lock');
    }
  }

  async handle(job: Job<WaCommandJob>) {
    const { sessionId, tenantId, command } = job.data;
    const session = await prisma.waSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      // sessão apagada: no logout ainda limpamos o que este worker segura
      if (command === 'logout') {
        await this.gateway.disconnect(sessionId);
        await this.releaseLock(sessionId);
      }
      return;
    }
    if (session.tenantId !== tenantId) {
      log.warn(
        { sessionId, tenantId, owner: session.tenantId },
        'tenant do job não bate com o da sessão',
      );
      return;
    }
    switch (command) {
      case 'connect': {
        if (!(await this.acquireLock(sessionId))) {
          log.warn({ sessionId }, 'outro worker detém o lock');
          return;
        }
        const opts: { mode: 'qr' | 'pair'; phone?: string } = { mode: job.data.mode ?? 'qr' };
        if (job.data.phone) opts.phone = job.data.phone;
        await this.gateway.connect({ id: sessionId, tenantId }, opts);
        return;
      }
      case 'disconnect':
        await this.gateway.disconnect(sessionId);
        await this.releaseLock(sessionId);
        return;
      case 'logout':
        await this.gateway.logout(sessionId);
        await this.releaseLock(sessionId);
        return;
      case 'sync-groups':
        await this.syncGroups(sessionId, tenantId);
        return;
    }
  }

  async syncGroups(sessionId: string, tenantId: string) {
    const groups = await this.gateway.fetchGroups(sessionId);
    await prisma.$transaction([
      prisma.waGroup.deleteMany({
        where: { sessionId, jid: { notIn: groups.map((g) => g.jid) } },
      }),
      ...groups.map((g) =>
        prisma.waGroup.upsert({
          where: { sessionId_jid: { sessionId, jid: g.jid } },
          update: {
            name: g.name,
            kind: g.kind,
            botIsAdmin: g.botIsAdmin,
            memberCount: g.memberCount,
            syncedAt: new Date(),
          },
          create: {
            tenantId,
            sessionId,
            jid: g.jid,
            name: g.name,
            kind: g.kind,
            botIsAdmin: g.botIsAdmin,
            memberCount: g.memberCount,
          },
        }),
      ),
    ]);
    await publishEvent(tenantId, { type: 'wa.groups.synced', sessionId, count: groups.length });
  }
}
