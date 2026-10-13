import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { assertGroupOfTenant } from '../src/lib/metrics/common';
import { getSendsMetrics } from '../src/lib/metrics/sends';
import { cleanupTenant } from './helpers';
import { addGroup, addSendLog, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const G1 = 'sends-g1@g.us';
const G2 = 'sends-g2@g.us';
const range = { from: spMidnight('2025-12-30'), to: spMidnight('2026-01-02') };
let ctx: MetricsCtx;
let other: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('sends');
  other = await createMetricsTenant('sends-other');
  await addGroup(ctx, G1);
  await addGroup(ctx, G2);
  await addGroup(other, 'sends-other@g.us');
  await addSendLog(ctx, G1, '2025-12-31T12:00:00Z'); // 31/12 09h SP (quarta)
  await addSendLog(ctx, G1, '2026-01-01T02:30:00Z'); // 31/12 23h30 SP (quarta)
  await addSendLog(ctx, G2, '2026-01-01T03:30:00Z', 'ERROR', { error: 'timeout' }); // 01/01 00h30 SP (quinta)
  await addSendLog(ctx, G2, '2026-01-01T15:00:00Z', 'ERROR', { error: 'timeout' }); // 01/01 12h SP
  await addSendLog(ctx, G1, '2026-01-01T16:00:00Z', 'ERROR', { error: 'not-admin' }); // 01/01 13h SP
  await addSendLog(other, 'sends-other@g.us', '2026-01-01T12:00:00Z');
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getSendsMetrics', () => {
  it('totaliza sucesso e falha só do tenant', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.totals).toEqual({ total: 5, sent: 2, failed: 3, successRate: 40 });
  });

  it('agrupa por dia no fuso de SP, com dias vazios preenchidos', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.daily).toEqual([
      { date: '2025-12-30', sent: 0, failed: 0 },
      { date: '2025-12-31', sent: 2, failed: 0 },
      { date: '2026-01-01', sent: 0, failed: 3 },
    ]);
  });

  it('distribui por hora local e monta o heatmap 7x24', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.hourly).toHaveLength(24);
    expect(m.hourly[9]).toEqual({ hour: 9, sent: 1, failed: 0 });
    expect(m.hourly[23]).toEqual({ hour: 23, sent: 1, failed: 0 });
    expect(m.hourly[0]).toEqual({ hour: 0, sent: 0, failed: 1 });
    expect(m.heatmap).toHaveLength(168);
    expect(m.heatmap.find((c) => c.weekday === 3 && c.hour === 23)?.count).toBe(1);
    expect(m.heatmap.find((c) => c.weekday === 4 && c.hour === 0)?.count).toBe(1);
    expect(m.heatmap.reduce((s, c) => s + c.count, 0)).toBe(5);
  });

  it('lista os principais erros', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.topErrors).toEqual([
      { error: 'timeout', count: 2 },
      { error: 'not-admin', count: 1 },
    ]);
  });

  it('filtra por groupJid', async () => {
    const m = await getSendsMetrics(ctx.tenantId, { ...range, groupJid: G2 });
    expect(m.totals).toEqual({ total: 2, sent: 0, failed: 2, successRate: 0 });
  });

  it('período sem registros devolve zeros', async () => {
    const m = await getSendsMetrics(ctx.tenantId, {
      from: spMidnight('2027-01-01'),
      to: spMidnight('2027-01-03'),
    });
    expect(m.totals).toEqual({ total: 0, sent: 0, failed: 0, successRate: 0 });
    expect(m.daily).toEqual([
      { date: '2027-01-01', sent: 0, failed: 0 },
      { date: '2027-01-02', sent: 0, failed: 0 },
    ]);
    expect(m.topErrors).toEqual([]);
  });
});

describe('assertGroupOfTenant', () => {
  it('aceita grupo do tenant ou ausência de grupo', async () => {
    await expect(assertGroupOfTenant(ctx.tenantId, G1)).resolves.toBeUndefined();
    await expect(assertGroupOfTenant(ctx.tenantId, undefined)).resolves.toBeUndefined();
  });
  it('grupo de outro tenant é 404', async () => {
    await expect(assertGroupOfTenant(ctx.tenantId, 'sends-other@g.us')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
