import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Job } from 'bullmq';
import { prisma } from '@afilados/db';
import { spDayKey, spMidnight, type MetricsDailyJob } from '@afilados/shared';
import { purgeOldMetrics, snapshotGroups } from '../src/metrics/group-snapshots';
import { createMetricsDailyProcessor, scheduleMetricsDaily } from '../src/processors/metrics-daily';
import { WaSessionManager } from '../src/wa/session-manager';
import type { BaileysGateway } from '../src/wa/baileys-gateway';
import type { GroupInfo } from '../src/wa/gateway';
import { closeRedis } from '../src/lib/redis';

const ADMIN_GROUP = 'snap-admin@g.us';
const COMMON_GROUP = 'snap-common@g.us';
const NOW = new Date('2026-10-14T01:00:00Z'); // 13/10 às 22h em SP
const DAY = new Date('2026-10-13T03:00:00Z');
const DAY_MS = 86_400_000;
let tenantId: string;
let sessionId: string;
let groupLinkId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'snapshots' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 'chip' } })).id;
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: ADMIN_GROUP, name: 'A', botIsAdmin: true, memberCount: 40 },
  });
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: COMMON_GROUP, name: 'C', botIsAdmin: false, memberCount: 9 },
  });
  groupLinkId = (
    await prisma.groupLink.create({
      data: { tenantId, sessionId, slug: `snap-${Date.now()}`, label: 'L', baseName: 'G' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await closeRedis();
});

describe('snapshotGroups', () => {
  it('grava um snapshot por grupo com bot admin, no dia de SP', async () => {
    expect(await snapshotGroups({ sessionId }, NOW)).toBe(1);
    const rows = await prisma.groupSnapshot.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ groupJid: ADMIN_GROUP, memberCount: 40, date: DAY });
  });

  it('repetir no mesmo dia atualiza sem duplicar', async () => {
    await prisma.waGroup.updateMany({
      where: { sessionId, jid: ADMIN_GROUP },
      data: { memberCount: 45 },
    });
    await snapshotGroups({ sessionId }, new Date('2026-10-13T20:00:00Z'));
    const rows = await prisma.groupSnapshot.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.memberCount).toBe(45);
  });
});

describe('purgeOldMetrics', () => {
  it('apaga só o que passou da retenção', async () => {
    const old = new Date(NOW.getTime() - 400 * DAY_MS);
    const recent = new Date(NOW.getTime() - 10 * DAY_MS);
    const event = (occurredAt: Date, key: string) => ({
      tenantId,
      sessionId,
      groupJid: ADMIN_GROUP,
      participantJid: 'p@s.whatsapp.net',
      action: 'JOIN' as const,
      occurredAt,
      dedupeKey: `purge-${key}-${Date.now()}`,
    });
    await prisma.groupMemberEvent.createMany({ data: [event(old, 'old'), event(recent, 'new')] });
    await prisma.groupSnapshot.create({
      data: { tenantId, sessionId, groupJid: ADMIN_GROUP, date: old, memberCount: 1 },
    });
    await prisma.linkClickEvent.createMany({
      data: [
        { tenantId, groupLinkId, slug: 's', clickedAt: old },
        { tenantId, groupLinkId, slug: 's', clickedAt: recent },
      ],
    });

    const res = await purgeOldMetrics(NOW, 365);
    expect(res.events).toBeGreaterThanOrEqual(1);
    expect(res.snapshots).toBeGreaterThanOrEqual(1);
    expect(res.clicks).toBeGreaterThanOrEqual(1);
    expect(await prisma.groupMemberEvent.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.groupSnapshot.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.linkClickEvent.count({ where: { tenantId } })).toBe(1);
  });
});

describe('job diário', () => {
  it('processor tira snapshot e aplica retenção', async () => {
    const proc = createMetricsDailyProcessor({ retentionDays: 365, now: () => NOW });
    const out = await proc({ data: { trigger: 'manual' } } as Job<MetricsDailyJob>);
    expect(out.snapshots).toBeGreaterThanOrEqual(1);
    expect(await prisma.groupSnapshot.count({ where: { tenantId, date: DAY } })).toBe(1);
  });

  it('agenda à meia-noite de America/Sao_Paulo', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await scheduleMetricsDaily({ upsertJobScheduler });
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'metrics-daily',
      { pattern: '0 0 * * *', tz: 'America/Sao_Paulo' },
      { name: 'daily', data: { trigger: 'schedule' } },
    );
  });
});

describe('syncGroups', () => {
  it('grava snapshot dos grupos sincronizados', async () => {
    class FakeGateway {
      async fetchGroups(): Promise<GroupInfo[]> {
        return [
          { jid: ADMIN_GROUP, name: 'A', kind: 'GROUP', botIsAdmin: true, memberCount: 50 },
          { jid: COMMON_GROUP, name: 'C', kind: 'GROUP', botIsAdmin: false, memberCount: 9 },
        ];
      }
    }
    const manager = new WaSessionManager(new FakeGateway() as unknown as BaileysGateway);
    await manager.syncGroups(sessionId, tenantId);
    const today = spMidnight(spDayKey(new Date()));
    const snap = await prisma.groupSnapshot.findFirst({
      where: { tenantId, groupJid: ADMIN_GROUP, date: today },
    });
    expect(snap?.memberCount).toBe(50);
    expect(await prisma.groupSnapshot.count({ where: { tenantId, groupJid: COMMON_GROUP } })).toBe(
      0,
    );
  });
});
