import { prisma } from '@afilados/db';
import {
  SALES_PAGE_SIZE,
  spAddDays,
  spDayKey,
  type SaleChannelKind,
  type SalesAdvertiserRow,
  type SalesChannelRow,
  type SalesList,
  type SalesQuery,
  type SalesSummary,
} from '@afilados/shared';

const NO_CHANNEL = 'Sem canal identificado';
const round2 = (n: number) => Math.round(n * 100) / 100;

interface ChannelInfo {
  id: string;
  kind: SaleChannelKind;
  name: string;
  trackCode: string | null;
}

/** Cartões, tabela por canal, por loja e série diária do período (`from` inclusivo, `to` exclusivo). */
export async function getSalesSummary(
  tenantId: string,
  q: Pick<SalesQuery, 'from' | 'to'>,
): Promise<SalesSummary> {
  const [sales, clickGroups] = await Promise.all([
    prisma.affiliateSale.findMany({
      where: { tenantId, transactionDate: { gte: q.from, lt: q.to } },
      select: {
        advertiserId: true,
        advertiserName: true,
        saleAmount: true,
        commissionAmount: true,
        currency: true,
        status: true,
        transactionDate: true,
        channelId: true,
        channelKind: true,
        channelName: true,
      },
    }),
    prisma.offerClick.groupBy({
      by: ['channelCode'],
      where: { tenantId, clickedAt: { gte: q.from, lt: q.to } },
      _count: { _all: true },
    }),
  ]);

  // Canais citados por cliques (trackCode) ou vendas (channelId).
  const codes = clickGroups.map((c) => c.channelCode).filter((c): c is string => !!c);
  const ids = [...new Set(sales.map((s) => s.channelId).filter((c): c is string => !!c))];
  const [groups, chats] = await Promise.all([
    codes.length || ids.length
      ? prisma.waGroup.findMany({
          where: { tenantId, OR: [{ trackCode: { in: codes } }, { id: { in: ids } }] },
          select: { id: true, name: true, trackCode: true },
        })
      : [],
    codes.length || ids.length
      ? prisma.telegramChat.findMany({
          where: { tenantId, OR: [{ trackCode: { in: codes } }, { id: { in: ids } }] },
          select: { id: true, title: true, trackCode: true },
        })
      : [],
  ]);
  const byId = new Map<string, ChannelInfo>();
  const byCode = new Map<string, ChannelInfo>();
  for (const g of groups) {
    const info: ChannelInfo = { id: g.id, kind: 'WHATSAPP', name: g.name, trackCode: g.trackCode };
    byId.set(g.id, info);
    if (g.trackCode) byCode.set(g.trackCode, info);
  }
  for (const c of chats) {
    const info: ChannelInfo = { id: c.id, kind: 'TELEGRAM', name: c.title, trackCode: c.trackCode };
    byId.set(c.id, info);
    if (c.trackCode) byCode.set(c.trackCode, info);
  }

  const rows = new Map<string, SalesChannelRow>();
  const rowFor = (
    key: string,
    init: () => Omit<
      SalesChannelRow,
      'clicks' | 'sales' | 'commissionPending' | 'commissionApproved' | 'conversion'
    >,
  ) => {
    let row = rows.get(key);
    if (!row) {
      row = {
        ...init(),
        clicks: 0,
        sales: 0,
        commissionPending: 0,
        commissionApproved: 0,
        conversion: null,
      };
      rows.set(key, row);
    }
    return row;
  };
  const noChannel = () => ({
    channelId: null,
    channelKind: null,
    channelName: NO_CHANNEL,
    trackCode: null,
  });

  let totalClicks = 0;
  for (const c of clickGroups) {
    const n = c._count._all;
    totalClicks += n;
    const info = c.channelCode ? byCode.get(c.channelCode) : undefined;
    const row = info
      ? rowFor(info.id, () => ({
          channelId: info.id,
          channelKind: info.kind,
          channelName: info.name,
          trackCode: info.trackCode,
        }))
      : rowFor('', noChannel);
    row.clicks += n;
  }

  const advertisers = new Map<string, SalesAdvertiserRow>();
  const daily = new Map<string, { sales: number; commission: number }>();
  const currencies = new Set<string>();
  let commissionApproved = 0;
  let commissionPending = 0;
  let salesCount = 0;
  let declined = 0;

  for (const s of sales) {
    currencies.add(s.currency);
    if (s.status === 'DECLINED') declined++;
    if (s.status !== 'PENDING' && s.status !== 'APPROVED') continue;
    const commission = Number(s.commissionAmount);
    const approved = s.status === 'APPROVED';
    salesCount++;
    if (approved) commissionApproved += commission;
    else commissionPending += commission;

    const info = s.channelId ? byId.get(s.channelId) : undefined;
    const row = s.channelId
      ? rowFor(s.channelId, () => ({
          channelId: s.channelId,
          channelKind: info?.kind ?? s.channelKind ?? null,
          channelName: info?.name ?? s.channelName ?? 'Canal removido',
          trackCode: info?.trackCode ?? null,
        }))
      : rowFor('', noChannel);
    row.sales++;
    if (approved) row.commissionApproved += commission;
    else row.commissionPending += commission;

    let adv = advertisers.get(s.advertiserId);
    if (!adv) {
      adv = {
        advertiserId: s.advertiserId,
        advertiserName: s.advertiserName,
        sales: 0,
        saleAmount: 0,
        commissionPending: 0,
        commissionApproved: 0,
      };
      advertisers.set(s.advertiserId, adv);
    }
    adv.advertiserName ??= s.advertiserName;
    adv.sales++;
    adv.saleAmount += Number(s.saleAmount);
    if (approved) adv.commissionApproved += commission;
    else adv.commissionPending += commission;

    const day = spDayKey(s.transactionDate);
    const d = daily.get(day) ?? { sales: 0, commission: 0 };
    d.sales++;
    d.commission += commission;
    daily.set(day, d);
  }

  const days: SalesSummary['daily'] = [];
  const lastDay = spDayKey(new Date(q.to.getTime() - 1));
  for (let day = spDayKey(q.from); day <= lastDay; day = spAddDays(day, 1)) {
    const d = daily.get(day);
    days.push({ date: day, sales: d?.sales ?? 0, commission: round2(d?.commission ?? 0) });
  }

  const commissionOf = (r: { commissionApproved: number; commissionPending: number }) =>
    r.commissionApproved + r.commissionPending;
  const byChannel = [...rows.values()]
    .map((r) => ({
      ...r,
      commissionApproved: round2(r.commissionApproved),
      commissionPending: round2(r.commissionPending),
      conversion: r.clicks > 0 ? r.sales / r.clicks : null,
    }))
    .sort((a, b) => {
      if (a.channelId === null) return 1;
      if (b.channelId === null) return -1;
      return commissionOf(b) - commissionOf(a) || b.sales - a.sales || b.clicks - a.clicks;
    });
  const byAdvertiser = [...advertisers.values()]
    .map((a) => ({
      ...a,
      saleAmount: round2(a.saleAmount),
      commissionApproved: round2(a.commissionApproved),
      commissionPending: round2(a.commissionPending),
    }))
    .sort((a, b) => commissionOf(b) - commissionOf(a) || b.sales - a.sales);

  return {
    from: q.from.toISOString(),
    to: q.to.toISOString(),
    currencies: [...currencies].sort(),
    totals: {
      commissionApproved: round2(commissionApproved),
      commissionPending: round2(commissionPending),
      sales: salesCount,
      declined,
      clicks: totalClicks,
      conversion: totalClicks > 0 ? salesCount / totalClicks : null,
    },
    byChannel,
    byAdvertiser,
    daily: days,
  };
}

/** Últimas vendas do período (mais recentes primeiro), paginadas. */
export async function listSales(tenantId: string, q: SalesQuery): Promise<SalesList> {
  const where = {
    tenantId,
    transactionDate: { gte: q.from, lt: q.to },
    ...(q.status ? { status: q.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.affiliateSale.findMany({
      where,
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * SALES_PAGE_SIZE,
      take: SALES_PAGE_SIZE,
    }),
    prisma.affiliateSale.count({ where }),
  ]);
  return {
    page: q.page,
    pageSize: SALES_PAGE_SIZE,
    total,
    items: rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      advertiserId: r.advertiserId,
      advertiserName: r.advertiserName,
      saleAmount: Number(r.saleAmount),
      commissionAmount: Number(r.commissionAmount),
      currency: r.currency,
      status: r.status,
      transactionDate: r.transactionDate.toISOString(),
      validationDate: r.validationDate?.toISOString() ?? null,
      channelKind: r.channelKind,
      channelName: r.channelName,
      source: r.source,
    })),
  };
}
