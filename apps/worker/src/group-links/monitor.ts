import pino from 'pino';
import { prisma } from '@afilados/db';
import { QUEUE_GROUP_LINK_ROTATE, type GroupLinkRotateJob } from '@afilados/shared';
import { getQueue } from '../lib/redis';
import type { GroupParticipantsUpdateEvent, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'group-link-monitor' });

export interface CachedGroupLinkEntry {
  managedGroupId: string;
  groupLinkId: string;
  tenantId: string;
  memberLimit: number;
  rotateMargin: number;
  rotateAt: number;
  memberCount: number;
  isActive: boolean;
}

interface QueueLike {
  add(
    name: string,
    data: GroupLinkRotateJob,
    opts: { jobId?: string; attempts: number; backoff: { type: string; delay: number } },
  ): Promise<unknown>;
}

export class GroupLinkMonitor {
  /** sessionId -> jid -> CachedGroupLinkEntry */
  private cache = new Map<string, Map<string, CachedGroupLinkEntry>>();
  private reconcileTimer?: NodeJS.Timeout | undefined;
  private readonly queue: QueueLike;

  constructor(
    private readonly gateway: Pick<
      WhatsAppGateway,
      'onGroupParticipants' | 'isConnected' | 'getGroupSnapshot'
    >,
    deps: { queue?: QueueLike } = {},
  ) {
    this.queue = deps.queue ?? (getQueue<GroupLinkRotateJob>(QUEUE_GROUP_LINK_ROTATE) as QueueLike);
  }

  async start() {
    await this.reload();
    this.gateway.onGroupParticipants((ev) => {
      void this.handleParticipantsUpdate(ev).catch((err) =>
        log.error(
          { err, sessionId: ev.sessionId, jid: ev.jid },
          'falha ao processar atualização de participantes',
        ),
      );
    });

    // Reconciliação periódica a cada 5 minutos
    this.reconcileTimer = setInterval(
      () => {
        void this.reconcileAll().catch((err) =>
          log.error({ err }, 'falha na reconciliação periódica de grupos gerenciados'),
        );
      },
      5 * 60 * 1000,
    );
  }

  stop() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = undefined;
    }
  }

  async reload() {
    const links = await prisma.groupLink.findMany({
      where: { enabled: true, status: 'ACTIVE' },
      include: {
        groups: {
          where: { status: 'ACTIVE', jid: { not: null } },
        },
      },
    });

    const next = new Map<string, Map<string, CachedGroupLinkEntry>>();
    for (const link of links) {
      const activeGroup = link.groups[0];
      if (!activeGroup || !activeGroup.jid) continue;

      if (!next.has(link.sessionId)) {
        next.set(link.sessionId, new Map());
      }
      const sessionMap = next.get(link.sessionId)!;
      const rotateAt = Math.max(1, link.memberLimit - link.rotateMargin);

      sessionMap.set(activeGroup.jid, {
        managedGroupId: activeGroup.id,
        groupLinkId: link.id,
        tenantId: link.tenantId,
        memberLimit: link.memberLimit,
        rotateMargin: link.rotateMargin,
        rotateAt,
        memberCount: activeGroup.memberCount,
        isActive: true,
      });
    }

    this.cache = next;
    log.info({ trackedGroups: this.groupCount() }, 'Cache de links de grupos recarregado');
  }

  groupCount() {
    let total = 0;
    for (const m of this.cache.values()) {
      total += m.size;
    }
    return total;
  }

  getGroupEntry(sessionId: string, jid: string) {
    return this.cache.get(sessionId)?.get(jid);
  }

  private async handleParticipantsUpdate(ev: GroupParticipantsUpdateEvent) {
    const sessionMap = this.cache.get(ev.sessionId);
    if (!sessionMap) return;
    const entry = sessionMap.get(ev.jid);
    if (!entry) return;

    let delta = 0;
    if (ev.action === 'add') {
      delta = ev.participants.length;
    } else if (ev.action === 'remove') {
      delta = -ev.participants.length;
    } else {
      // promote/demote - não altera contagem de membros
      return;
    }

    const newCount = Math.max(0, entry.memberCount + delta);
    entry.memberCount = newCount;

    await prisma.managedGroup.updateMany({
      where: { id: entry.managedGroupId },
      data: {
        memberCount: { increment: delta },
        countSyncedAt: new Date(),
      },
    });

    log.info(
      { groupLinkId: entry.groupLinkId, jid: ev.jid, delta, newCount, rotateAt: entry.rotateAt },
      'Contagem de membros atualizada por evento',
    );

    if (entry.isActive && newCount >= entry.rotateAt) {
      log.info(
        { groupLinkId: entry.groupLinkId, memberCount: newCount, rotateAt: entry.rotateAt },
        'Limite de rotação atingido; enfileirando group-link-rotate',
      );
      await this.enqueueRotate({
        tenantId: entry.tenantId,
        groupLinkId: entry.groupLinkId,
        fromGroupId: entry.managedGroupId,
        reason: 'threshold',
      });
    }
  }

  async reconcileAll() {
    log.info('Iniciando reconciliação de grupos gerenciados');
    for (const [sessionId, sessionMap] of this.cache.entries()) {
      if (!this.gateway.isConnected(sessionId)) continue;

      for (const [jid, entry] of sessionMap.entries()) {
        await this.reconcileSingle(sessionId, jid, entry);
      }
    }
  }

  async reconcileSession(sessionId: string) {
    const sessionMap = this.cache.get(sessionId);
    if (!sessionMap || !this.gateway.isConnected(sessionId)) return;
    for (const [jid, entry] of sessionMap.entries()) {
      await this.reconcileSingle(sessionId, jid, entry);
    }
  }

  private async reconcileSingle(sessionId: string, jid: string, entry: CachedGroupLinkEntry) {
    try {
      const snap = await this.gateway.getGroupSnapshot(sessionId, jid);
      entry.memberCount = snap.memberCount;

      await prisma.managedGroup.updateMany({
        where: { id: entry.managedGroupId },
        data: {
          memberCount: snap.memberCount,
          countSyncedAt: new Date(),
          ...(snap.inviteCode
            ? {
                inviteLink: `https://chat.whatsapp.com/${snap.inviteCode}`,
                inviteSyncedAt: new Date(),
              }
            : {}),
        },
      });

      if (entry.isActive && snap.memberCount >= entry.rotateAt) {
        log.info(
          {
            groupLinkId: entry.groupLinkId,
            memberCount: snap.memberCount,
            rotateAt: entry.rotateAt,
          },
          'Reconciliação detectou limite atingido; enfileirando rotação',
        );
        await this.enqueueRotate({
          tenantId: entry.tenantId,
          groupLinkId: entry.groupLinkId,
          fromGroupId: entry.managedGroupId,
          reason: 'threshold',
        });
      }
    } catch (err) {
      log.error(
        { err, sessionId, jid, groupLinkId: entry.groupLinkId },
        'Falha na reconciliação do grupo; marcando ORPHANED',
      );
      await prisma.managedGroup.updateMany({
        where: { id: entry.managedGroupId },
        data: {
          status: 'ORPHANED',
          lastError: err instanceof Error ? err.message : String(err),
        },
      });

      // Remove do cache de ativos
      this.cache.get(sessionId)?.delete(jid);

      await this.enqueueRotate({
        tenantId: entry.tenantId,
        groupLinkId: entry.groupLinkId,
        fromGroupId: entry.managedGroupId,
        reason: 'orphaned',
      });
    }
  }

  private async enqueueRotate(job: GroupLinkRotateJob) {
    await this.queue.add('rotate', job, {
      jobId: `rotate-${job.groupLinkId}-${job.fromGroupId ?? 'initial'}-${job.reason}`.replace(
        /:/g,
        '-',
      ),
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  }
}
