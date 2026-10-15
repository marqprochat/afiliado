import type { Job } from 'bullmq';
import pino from 'pino';
import { prisma } from '@afilados/db';
import { GROUP_LINK_SYNC_FIELDS, buildGroupName, type GroupLinkSyncJob } from '@afilados/shared';
import { publishEvent } from '../lib/events';
import { applyGroupLinkSettings, LIVE_GROUP_STATUSES } from '../group-links/settings';
import type { WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'group-link-sync' });

/** Pausa entre grupos para não disparar o rate limit do WhatsApp. */
const GROUP_GAP_MS = 1_500;

export function createGroupLinkSyncProcessor(deps: {
  gateway: Pick<WhatsAppGateway, 'isConnected' | 'updateGroupSettings' | 'updateGroupPicture'>;
  sleep?: (ms: number) => Promise<void>;
}) {
  const { gateway } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async function processGroupLinkSync(job: Job<GroupLinkSyncJob>) {
    const { tenantId, groupLinkId } = job.data;
    // sem lista = sincronização completa (inclui renomear)
    const fields = job.data.fields?.length ? job.data.fields : [...GROUP_LINK_SYNC_FIELDS];

    const link = await prisma.groupLink.findFirst({ where: { id: groupLinkId, tenantId } });
    if (!link) return { skipped: true, reason: 'NOT_FOUND' };
    if (!gateway.isConnected(link.sessionId)) throw new Error('WA_NOT_CONNECTED');

    const groups = await prisma.managedGroup.findMany({
      where: { groupLinkId, status: { in: [...LIVE_GROUP_STATUSES] }, jid: { not: null } },
      orderBy: { sequence: 'asc' },
    });

    let updated = 0;
    const failures: string[] = [];

    for (const [i, g] of groups.entries()) {
      if (i > 0) await sleep(GROUP_GAP_MS);
      const res = await applyGroupLinkSettings(
        gateway,
        link.sessionId,
        link,
        { jid: g.jid!, number: g.number },
        fields,
      );
      if (res.errors.length) failures.push(`#${g.number}: ${res.errors.join('; ')}`);
      else updated++;

      if (res.applied.includes('subject')) {
        const name = buildGroupName({
          baseName: link.baseName,
          customText: link.customText,
          textPosition: link.textPosition,
          numberPrefix: link.numberPrefix,
          number: g.number,
        });
        await prisma.managedGroup.updateMany({ where: { id: g.id }, data: { name } });
      }
    }

    await prisma.groupLink.updateMany({
      where: { id: link.id },
      data: {
        lastError: failures.length
          ? `Falha ao atualizar ${failures.length} grupo(s): ${failures.join(' | ')}`.slice(0, 1000)
          : null,
      },
    });
    await publishEvent(tenantId, { type: 'group-links.changed', tenantId });

    log.info(
      { groupLinkId, total: groups.length, updated, failed: failures.length },
      'Configurações do link reaplicadas nos grupos',
    );
    return { total: groups.length, updated, failed: failures.length };
  };
}
