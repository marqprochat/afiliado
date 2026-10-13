import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getOverviewMetrics } from '../src/lib/metrics/overview';
import { cleanupTenant } from './helpers';
import {
  addClick,
  addGroup,
  addGroupLink,
  addMemberEvent,
  addSendLog,
  createMetricsTenant,
  type MetricsCtx,
} from './metrics-fixtures';

const OV1 = 'ov-g1@g.us';
const OV2 = 'ov-g2@g.us';
const range = { from: spMidnight('2026-08-08'), to: spMidnight('2026-08-15') };
let ctx: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('overview');
  await addGroup(ctx, OV1, { name: 'Zeta', memberCount: 200 });
  await addGroup(ctx, OV2, { name: 'Alfa', memberCount: 100 });
  await addGroup(ctx, 'ov-g3@g.us', { name: 'Comum', memberCount: 70, botIsAdmin: false });

  // período atual
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-09T12:00:00Z');
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-09T13:00:00Z');
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-09T14:00:00Z');
  await addMemberEvent(ctx, OV1, 'LEAVE', '2026-08-10T12:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T15:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T16:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T17:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T18:00:00Z', 'ERROR', { error: 'x' });
  const link = await addGroupLink(ctx, `ov-${Date.now()}`, 'Link');
  await addClick(ctx, link.id, link.slug, '2026-08-09T12:00:00Z', OV1);
  await addClick(ctx, link.id, link.slug, '2026-08-09T13:00:00Z', OV1);

  // período anterior (01/08 a 07/08)
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-02T12:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-02T15:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-02T16:00:00Z');
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
});

describe('getOverviewMetrics', () => {
  it('KPIs com variação vs período anterior', async () => {
    const m = await getOverviewMetrics(ctx.tenantId, range);
    expect(m.kpis).toEqual({
      members: { current: 300, previous: 298, changePct: 0.7 },
      joins: { current: 3, previous: 1, changePct: 200 },
      leaves: { current: 1, previous: 0, changePct: null },
      net: { current: 2, previous: 1, changePct: 100 },
      sends: { current: 4, previous: 2, changePct: 100 },
      successRate: { current: 75, previous: 100, changePct: -25 },
      clicks: { current: 2, previous: 0, changePct: null },
    });
  });

  it('informa os intervalos, o início da coleta e os grupos do seletor', async () => {
    const m = await getOverviewMetrics(ctx.tenantId, range);
    expect(m.range).toEqual({
      from: '2026-08-08T03:00:00.000Z',
      to: '2026-08-15T03:00:00.000Z',
      previousFrom: '2026-08-01T03:00:00.000Z',
      previousTo: '2026-08-08T03:00:00.000Z',
    });
    expect(m.trackingSince).toBe('2026-08-02T12:00:00.000Z');
    expect(m.groupOptions).toEqual([
      { jid: OV2, name: 'Alfa' },
      { jid: OV1, name: 'Zeta' },
    ]);
  });

  it('groupJid filtra os KPIs mas não o seletor', async () => {
    const m = await getOverviewMetrics(ctx.tenantId, { ...range, groupJid: OV2 });
    expect(m.kpis.members).toEqual({ current: 100, previous: 100, changePct: 0 });
    expect(m.kpis.joins.current).toBe(0);
    expect(m.kpis.sends.current).toBe(0);
    expect(m.kpis.clicks.current).toBe(0);
    expect(m.groupOptions).toHaveLength(2);
  });
});
