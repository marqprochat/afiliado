import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import type { WaCommandJob } from '@afilados/shared';
import { getRedis } from '../lib/redis';
import { publishEvent } from '../lib/events';
import type { BaileysGateway } from './baileys-gateway';

const log = pino({ name: 'wa-manager' });
const LOCK_TTL_MS = 30_000;

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
    for (const [id, t] of this.locks) {
      clearInterval(t);
      await getRedis().del(`wa:lock:${id}`);
    }
    this.locks.clear();
  }

  private async acquireLock(sessionId: string): Promise<boolean> {
    const key = `wa:lock:${sessionId}`;
    const ok = await getRedis().set(key, this.owner, 'PX', LOCK_TTL_MS, 'NX');
    if (ok !== 'OK') {
      const holder = await getRedis().get(key);
      if (holder !== this.owner) return false;
    }
    if (!this.locks.has(sessionId)) {
      const t = setInterval(() => {
        getRedis()
          .pexpire(key, LOCK_TTL_MS)
          .catch(() => undefined);
      }, 10_000);
      this.locks.set(sessionId, t);
    }
    return true;
  }

  private async releaseLock(sessionId: string) {
    const t = this.locks.get(sessionId);
    if (t) clearInterval(t);
    this.locks.delete(sessionId);
    await getRedis().del(`wa:lock:${sessionId}`);
  }

  async handle(job: Job<WaCommandJob>) {
    const { sessionId, tenantId, command } = job.data;
    const session = await prisma.waSession.findUnique({ where: { id: sessionId } });
    if (!session && command !== 'logout') return; // sessão apagada
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
