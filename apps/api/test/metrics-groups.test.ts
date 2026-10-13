import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getGroupsMetrics, getTrackingSince } from '../src/lib/metrics/groups';
import { cleanupTenant } from './helpers';
import {
  addGroup,
  addMemberEvent,
  addSnapshot,
  createMetricsTenant,
  type MetricsCtx,
} from './metrics-fixtures';

const G1 = 'gr-g1@g.us';
const G2 = 'gr-g2@g.us';
const G3 = 'gr-g3@g.us';
const range = { from: spMidnight('2026-06-01'), to: spMidnight('2026-06-04') };
let ctx: MetricsCtx;
let other: MetricsCtx;
let empty: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('groups');
  other = await createMetricsTenant('groups-other');
  empty = await createMetricsTenant('groups-empty');
  await addGroup(ctx, G1, { name: 'Alfa', memberCount: 100 });
  await addGroup(ctx, G2, { name: 'Beta', memberCount: 50 });
  await addGroup(ctx, G3, { name: 'Comum', memberCount: 30, botIsAdmin: false });
  await addGroup(other, 'gr-other@g.us', { name: 'Outro', memberCount: 999 });

  await addMemberEvent(ctx, G1, 'JOIN', '2026-05-31T12:00:00Z'); // fora do período
  await addMemberEvent(ctx, G1, 'JOIN', '2026-06-01T12:00:00Z');
  await addMemberEvent(ctx, G1, 'ADDED', '2026-06-01T13:00:00Z');
  await addMemberEvent(ctx, G1, 'LEAVE', '2026-06-02T12:00:00Z');
  await addMemberEvent(ctx, G1, 'PROMOTED', '2026-06-02T12:30:00Z');
  await addMemberEvent(ctx, G1, 'JOIN', '2026-06-04T02:00:00Z'); // 03/06 23h em SP
  await addMemberEvent(ctx, G2, 'REMOVED', '2026-06-03T12:00:00Z');
  await addMemberEvent(ctx, G2, 'LEAVE', '2026-06-03T13:00:00Z');
  await addMemberEvent(other, 'gr-other@g.us', 'JOIN', '2026-06-01T12:00:00Z');

  await addSnapshot(ctx, G1, '2026-06-01', 98);
  await addSnapshot(ctx, G2, '2026-06-01', 52);
  await addSnapshot(ctx, G1, '2026-06-03', 100);
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
  await cleanupTenant(empty.tenantId);
});

describe('getGroupsMetrics', () => {
  it('totais do período só com grupos monitorados do tenant', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, range);
    expect(m.totals).toEqual({ members: 150, joins: 3, leaves: 3, net: 0 });
  });

  it('série diária em SP com saldo acumulado e snapshots', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, range);
    expect(m.series).toEqual([
      { date: '2026-06-01', joins: 2, leaves: 0, net: 2, cumulativeNet: 2, members: 150 },
      { date: '2026-06-02', joins: 0, leaves: 1, net: -1, cumulativeNet: 1, members: null },
      { date: '2026-06-03', joins: 1, leaves: 2, net: -1, cumulativeNet: 0, members: 100 },
    ]);
  });

  it('tabela por grupo ordenada por saldo', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, range);
    expect(m.groups).toEqual([
      { jid: G1, name: 'Alfa', members: 100, joins: 3, leaves: 1, net: 2, growthPct: 2 },
      { jid: G2, name: 'Beta', members: 50, joins: 0, leaves: 2, net: -2, growthPct: -3.8 },
    ]);
  });

  it('filtra por groupJid', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, { ...range, groupJid: G2 });
    expect(m.totals).toEqual({ members: 50, joins: 0, leaves: 2, net: -2 });
    expect(m.groups.map((g) => g.jid)).toEqual([G2]);
  });

  it('trackingSince é o primeiro evento ou snapshot', async () => {
    expect(await getTrackingSince(ctx.tenantId)).toBe('2026-05-31T12:00:00.000Z');
    expect(await getTrackingSince(empty.tenantId)).toBeNull();
  });

  it('tenant sem dados devolve zeros', async () => {
    const m = await getGroupsMetrics(empty.tenantId, range);
    expect(m.trackingSince).toBeNull();
    expect(m.totals).toEqual({ members: 0, joins: 0, leaves: 0, net: 0 });
    expect(m.groups).toEqual([]);
    expect(m.series).toHaveLength(3);
    expect(m.series[0]).toEqual({
      date: '2026-06-01',
      joins: 0,
      leaves: 0,
      net: 0,
      cumulativeNet: 0,
      members: null,
    });
  });
});
