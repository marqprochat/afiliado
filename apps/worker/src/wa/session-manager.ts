import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import {
  QUEUE_GROUP_LINK_ROTATE,
  type GroupLinkRotateJob,
  type WaCommandJob,
} from '@afilados/shared';
import { getRedis, getQueue } from '../lib/redis';
import { publishEvent } from '../lib/events';
import type { BaileysGateway } from './baileys-gateway';

const log = pino({ name: 'wa-manager' });
const LOCK_TTL_MS = 30_000;
const LOCK_RENEW_MS = 10_000;
const RECONCILE_INTERVAL_MS = 15_000;

/** só renova se ainda formos o dono do lock */
const RENEW_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
/** só apaga se ainda formos o dono do lock */
const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

const lockKey = (sessionId: string) => `wa:lock:${sessionId}`;

export class WaSessionManager {
  private locks = new Map<string, NodeJS.Timeout>();
  private readonly owner = `worker:${process.pid}:${Math.random().toString(36).slice(2)}`;
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(private readonly gateway: BaileysGateway) {}

  sessionCount() {
    return this.gateway.count();
  }

  async start() {
    await this.reconcile();
    if (!this.reconcileTimer) {
      this.reconcileTimer = setInterval(() => {
        void this.reconcile();
      }, RECONCILE_INTERVAL_MS);
    }
  }

  async reconcile() {
    try {
      const sessions = await prisma.waSession.findMany({
        where: { status: { in: ['CONNECTING', 'NEEDS_QR', 'CONNECTED'] } },
      });
      for (const s of sessions) {
        if (this.locks.has(s.id)) continue;
        if (await this.acquireLock(s.id)) {
          log.info({ sessionId: s.id, tenantId: s.tenantId }, 'iniciando conexão de sessão ativa');
          await this.gateway.connect({ id: s.id, tenantId: s.tenantId }, { mode: 'qr' });
        }
      }
    } catch (e) {
      log.error({ err: e }, 'falha ao reconciliar sessões do WhatsApp');
    }
  }

  async stop() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    for (const id of [...this.locks.keys()]) {
      try {
        await this.gateway.disconnect(id, true);
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
      case 'create-group': {
        try {
          const { jid } = await this.gateway.createGroup(
            sessionId,
            job.data.groupSubject ?? '',
            job.data.groupParticipants ?? [],
          );
          await this.syncGroups(sessionId, tenantId).catch(() => {});
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'create-group',
            ok: true,
            jid,
          });
        } catch (e) {
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'create-group',
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case 'group-participants': {
        const jid = job.data.groupJid;
        try {
          if (!jid || !job.data.participantAction) throw new Error('dados incompletos');
          await this.gateway.updateGroupParticipants(
            sessionId,
            jid,
            job.data.participantAction,
            job.data.groupParticipants ?? [],
          );
          await this.syncGroups(sessionId, tenantId).catch(() => {});
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'group-participants',
            ok: true,
            jid,
          });
        } catch (e) {
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'group-participants',
            ok: false,
            ...(jid ? { jid } : {}),
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case 'group-settings': {
        const jid = job.data.groupJid;
        try {
          if (!jid) throw new Error('groupJid obrigatório');
          await this.gateway.updateGroupSettings(sessionId, jid, {
            ...(job.data.subject !== undefined ? { subject: job.data.subject } : {}),
            ...(job.data.description !== undefined ? { description: job.data.description } : {}),
            ...(job.data.announceOnly !== undefined ? { announceOnly: job.data.announceOnly } : {}),
          });
          await prisma.waGroup.updateMany({
            where: { sessionId, jid },
            data: {
              ...(job.data.subject !== undefined ? { name: job.data.subject } : {}),
              ...(job.data.description !== undefined ? { description: job.data.description } : {}),
              ...(job.data.announceOnly !== undefined
                ? { announceOnly: job.data.announceOnly }
                : {}),
            },
          });
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'group-settings',
            ok: true,
            jid,
          });
        } catch (e) {
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'group-settings',
            ok: false,
            ...(jid ? { jid } : {}),
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case 'group-invite': {
        const jid = job.data.groupJid;
        try {
          if (!jid) throw new Error('groupJid obrigatório');
          const code = await this.gateway.getInviteCode(sessionId, jid, job.data.revokeInvite);
          await prisma.waGroup.updateMany({
            where: { sessionId, jid },
            data: { inviteLink: `https://chat.whatsapp.com/${code}` },
          });
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'group-invite',
            ok: true,
            jid,
          });
        } catch (e) {
          await publishEvent(tenantId, {
            type: 'wa.group.action',
            sessionId,
            action: 'group-invite',
            ok: false,
            ...(jid ? { jid } : {}),
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case 'group-details': {
        const jid = job.data.groupJid;
        try {
          if (!jid) throw new Error('groupJid obrigatório');
          const details = await this.gateway.getGroupDetails(sessionId, jid);
          await publishEvent(tenantId, {
            type: 'wa.group.details',
            sessionId,
            jid: details.jid,
            ok: true,
            subject: details.subject,
            description: details.description,
            announceOnly: details.announceOnly,
            inviteCode: details.inviteCode,
            participants: details.participants,
          });
        } catch (e) {
          await publishEvent(tenantId, {
            type: 'wa.group.details',
            sessionId,
            jid: jid ?? '',
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
    }
  }

  async syncGroups(sessionId: string, tenantId: string) {
    const groups = await this.gateway.fetchGroups(sessionId);
    if (groups.length === 0) {
      log.warn(
        { sessionId },
        'sincronização de grupos retornou lista vazia; mantendo grupos existentes',
      );
      return;
    }
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

    // Verifica ManagedGroups ativos cujo jid não foi retornado pelo WhatsApp
    try {
      const currentJids = new Set(groups.map((g) => g.jid));
      const activeManagedGroups = await prisma.managedGroup.findMany({
        where: {
          tenantId,
          groupLink: { sessionId },
          status: 'ACTIVE',
          jid: { not: null },
        },
        select: { id: true, jid: true, groupLinkId: true, tenantId: true },
      });

      for (const mg of activeManagedGroups) {
        if (mg.jid && !currentJids.has(mg.jid)) {
          log.warn(
            { managedGroupId: mg.id, jid: mg.jid, sessionId },
            'ManagedGroup ACTIVE não encontrado nos grupos da sessão; marcando ORPHANED',
          );
          await prisma.managedGroup.updateMany({
            where: { id: mg.id },
            data: { status: 'ORPHANED', lastError: 'GROUP_NOT_FOUND_IN_SESSION' },
          });
          const rotateQueue = getQueue<GroupLinkRotateJob>(QUEUE_GROUP_LINK_ROTATE);
          await rotateQueue.add(
            'rotate',
            {
              tenantId: mg.tenantId,
              groupLinkId: mg.groupLinkId,
              fromGroupId: mg.id,
              reason: 'orphaned',
            },
            {
              jobId: `rotate-${mg.groupLinkId}-${mg.id}-orphaned`.replace(/:/g, '-'),
              attempts: 5,
              backoff: { type: 'exponential', delay: 10_000 },
            },
          );
        }
      }
    } catch (err) {
      log.error({ err, sessionId }, 'falha ao verificar ManagedGroups órfãos em syncGroups');
    }
  }
}
