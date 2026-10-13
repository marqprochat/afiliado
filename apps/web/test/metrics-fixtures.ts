import type {
  MetricsAutomation,
  MetricsClicks,
  MetricsGroups,
  MetricsOverview,
  MetricsProducts,
  MetricsSends,
} from '@afilados/shared';

export const overviewFixture: MetricsOverview = {
  range: {
    from: '2026-10-07T03:00:00.000Z',
    to: '2026-10-14T03:00:00.000Z',
    previousFrom: '2026-09-30T03:00:00.000Z',
    previousTo: '2026-10-07T03:00:00.000Z',
  },
  trackingSince: '2026-10-01T12:00:00.000Z',
  groupOptions: [
    { jid: 'g1@g.us', name: 'Grupo 1' },
    { jid: 'g2@g.us', name: 'Grupo 2' },
  ],
  kpis: {
    members: { current: 1234, previous: 1200, changePct: 2.8 },
    joins: { current: 40, previous: 20, changePct: 100 },
    leaves: { current: 10, previous: 5, changePct: 100 },
    net: { current: 30, previous: 15, changePct: 100 },
    sends: { current: 200, previous: 100, changePct: 100 },
    successRate: { current: 95.5, previous: 90, changePct: 6.1 },
    clicks: { current: 12, previous: 0, changePct: null },
  },
};

export const groupsFixture: MetricsGroups = {
  trackingSince: '2026-10-01T12:00:00.000Z',
  totals: { members: 150, joins: 9, leaves: 5, net: 4 },
  series: [
    { date: '2026-10-12', joins: 4, leaves: 2, net: 2, cumulativeNet: 2, members: 148 },
    { date: '2026-10-13', joins: 5, leaves: 3, net: 2, cumulativeNet: 4, members: null },
  ],
  groups: [
    { jid: 'g1@g.us', name: 'Alfa', members: 100, joins: 6, leaves: 1, net: 5, growthPct: 5.3 },
    { jid: 'g2@g.us', name: 'Beta', members: 50, joins: 3, leaves: 4, net: -1, growthPct: -2 },
  ],
};

export const sendsFixture: MetricsSends = {
  totals: { total: 10, sent: 8, failed: 2, successRate: 80 },
  daily: [
    { date: '2026-10-12', sent: 5, failed: 1 },
    { date: '2026-10-13', sent: 3, failed: 1 },
  ],
  hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, sent: hour === 9 ? 8 : 0, failed: 0 })),
  heatmap: Array.from({ length: 168 }, (_, i) => ({
    weekday: Math.floor(i / 24),
    hour: i % 24,
    count: i === 3 * 24 + 23 ? 2 : 0,
  })),
  topErrors: [{ error: 'timeout', count: 2 }],
};

export const productsFixture: MetricsProducts = {
  top: [{ productId: 'p1', title: 'Fone Bluetooth', source: 'SHOPEE', image: null, sends: 5 }],
  byMarketplace: [
    { source: 'SHOPEE', sends: 5 },
    { source: 'AMAZON', sends: 2 },
  ],
};

export const clicksFixture: MetricsClicks = {
  total: 7,
  daily: [
    { date: '2026-10-12', clicks: 3 },
    { date: '2026-10-13', clicks: 4 },
  ],
  byLink: [{ groupLinkId: 'l1', slug: 'ofertas', label: 'Ofertas', clicks: 7 }],
};

export const automationFixture: MetricsAutomation = {
  mirror: { captured: 10, mirrored: 8, discarded: 1, errors: 1 },
  automation: { discovered: 20, dispatched: 5, skipped: 14, errors: 1 },
  coupons: { validated: 3, propagated: 6 },
  daily: [
    { date: '2026-10-12', mirrored: 4, dispatched: 2 },
    { date: '2026-10-13', mirrored: 4, dispatched: 3 },
  ],
};
