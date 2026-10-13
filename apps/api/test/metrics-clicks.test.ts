import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getClicksMetrics } from '../src/lib/metrics/clicks';
import { cleanupTenant } from './helpers';
import { addClick, addGroupLink, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const range = { from: spMidnight('2026-07-01'), to: spMidnight('2026-07-03') };
const suffix = Date.now();
const ofertas = `ck-ofertas-${suffix}`;
const cupons = `ck-cupons-${suffix}`;
let ctx: MetricsCtx;
let other: MetricsCtx;
let ofertasId: string;
let cuponsId: string;

beforeAll(async () => {
  ctx = await createMetricsTenant('clicks');
  other = await createMetricsTenant('clicks-other');
  ofertasId = (await addGroupLink(ctx, ofertas, 'Ofertas')).id;
  cuponsId = (await addGroupLink(ctx, cupons, 'Cupons')).id;
  const otherLink = await addGroupLink(other, `ck-other-${suffix}`, 'Outro');

  await addClick(ctx, ofertasId, ofertas, '2026-07-01T12:00:00Z', 'ck-g1@g.us');
  await addClick(ctx, ofertasId, ofertas, '2026-07-01T13:00:00Z', 'ck-g1@g.us');
  await addClick(ctx, ofertasId, ofertas, '2026-07-02T02:30:00Z', 'ck-g1@g.us'); // 01/07 23h30 SP
  await addClick(ctx, cuponsId, cupons, '2026-07-02T12:00:00Z');
  await addClick(ctx, ofertasId, ofertas, '2026-06-30T12:00:00Z', 'ck-g1@g.us'); // fora
  await addClick(other, otherLink.id, otherLink.slug, '2026-07-01T12:00:00Z');
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getClicksMetrics', () => {
  it('total, série diária em SP e ranking por link', async () => {
    const m = await getClicksMetrics(ctx.tenantId, range);
    expect(m.total).toBe(4);
    expect(m.daily).toEqual([
      { date: '2026-07-01', clicks: 3 },
      { date: '2026-07-02', clicks: 1 },
    ]);
    expect(m.byLink).toEqual([
      { groupLinkId: ofertasId, slug: ofertas, label: 'Ofertas', clicks: 3 },
      { groupLinkId: cuponsId, slug: cupons, label: 'Cupons', clicks: 1 },
    ]);
  });

  it('filtra pelo grupo de destino', async () => {
    const m = await getClicksMetrics(ctx.tenantId, { ...range, groupJid: 'ck-g1@g.us' });
    expect(m.total).toBe(3);
    expect(m.byLink.map((l) => l.slug)).toEqual([ofertas]);
  });

  it('período vazio devolve zeros', async () => {
    const m = await getClicksMetrics(ctx.tenantId, {
      from: spMidnight('2030-01-01'),
      to: spMidnight('2030-01-02'),
    });
    expect(m).toEqual({ total: 0, daily: [{ date: '2030-01-01', clicks: 0 }], byLink: [] });
  });
});
