import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { AWIN_WEBHOOK_TOKEN_KEY, type SalesList, type SalesSummary } from '@afilados/shared';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let gA: string;
let gB: string;
let tg: string;

const FROM = '2026-11-01T03:00:00.000Z';
const TO = '2026-11-04T03:00:00.000Z';

async function sale(over: {
  externalId: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'DELETED';
  commission: number;
  amount?: number;
  date: string;
  channelId?: string | null;
  channelKind?: 'WHATSAPP' | 'TELEGRAM';
  channelName?: string;
  advertiserId?: string;
  advertiserName?: string;
}) {
  await prisma.affiliateSale.create({
    data: {
      tenantId: t.tenantId,
      externalId: over.externalId,
      advertiserId: over.advertiserId ?? '9999',
      advertiserName: over.advertiserName ?? 'Loja A',
      saleAmount: over.amount ?? 100,
      commissionAmount: over.commission,
      status: over.status,
      transactionDate: new Date(over.date),
      channelId: over.channelId ?? null,
      channelKind: over.channelId ? (over.channelKind ?? 'WHATSAPP') : null,
      channelName: over.channelName ?? null,
      source: 'API',
      raw: {},
    },
  });
}

beforeAll(async () => {
  t = await createTenantWithUser('sales-summary');
  cookie = await loginCookie(app, t.email, t.password);
  const session = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 's', status: 'CONNECTED' },
  });
  gA = (
    await prisma.waGroup.create({
      data: {
        tenantId: t.tenantId,
        sessionId: session.id,
        jid: 'a@g.us',
        name: 'Grupo A',
        trackCode: 'wAAAA1',
      },
    })
  ).id;
  gB = (
    await prisma.waGroup.create({
      data: {
        tenantId: t.tenantId,
        sessionId: session.id,
        jid: 'b@g.us',
        name: 'Grupo B',
        trackCode: 'wBBBB1',
      },
    })
  ).id;
  const bot = await prisma.telegramBot.create({
    data: { tenantId: t.tenantId, label: 'b', encryptedToken: Buffer.from('x'), status: 'OK' },
  });
  tg = (
    await prisma.telegramChat.create({
      data: {
        tenantId: t.tenantId,
        botId: bot.id,
        chatId: '-1',
        title: 'Canal TG',
        kind: 'channel',
        trackCode: 'tTTTT1',
      },
    })
  ).id;

  // Cliques: A=4, B=1, TG=0, sem canal=2, fora do período=1
  const clicks = [...Array(4).fill('wAAAA1'), 'wBBBB1', null, 'wDesconhecido'].map((c) => ({
    tenantId: t.tenantId,
    listingId: 'l1',
    channelCode: c,
    clickedAt: new Date('2026-11-02T12:00:00Z'),
  }));
  clicks.push({
    tenantId: t.tenantId,
    listingId: 'l1',
    channelCode: 'wAAAA1',
    clickedAt: new Date('2026-10-01T12:00:00Z'),
  });
  await prisma.offerClick.createMany({ data: clicks });

  await sale({
    externalId: 's1',
    status: 'APPROVED',
    commission: 10,
    date: '2026-11-01T15:00:00Z',
    channelId: gA,
    channelName: 'Grupo A',
  });
  await sale({
    externalId: 's2',
    status: 'PENDING',
    commission: 5,
    date: '2026-11-02T15:00:00Z',
    channelId: gA,
    channelName: 'Grupo A',
    advertiserId: '8888',
    advertiserName: 'Loja B',
  });
  await sale({
    externalId: 's3',
    status: 'DECLINED',
    commission: 7,
    date: '2026-11-02T16:00:00Z',
    channelId: gB,
    channelName: 'Grupo B',
  });
  await sale({
    externalId: 's4',
    status: 'PENDING',
    commission: 2,
    date: '2026-11-03T15:00:00Z',
    channelId: tg,
    channelKind: 'TELEGRAM',
    channelName: 'Canal TG',
  });
  await sale({ externalId: 's5', status: 'APPROVED', commission: 1, date: '2026-11-03T16:00:00Z' });
  await sale({
    externalId: 's-fora',
    status: 'APPROVED',
    commission: 99,
    date: '2026-10-15T15:00:00Z',
    channelId: gA,
  });
});

afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('GET /sales/summary', () => {
  it('exige login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/sales/summary' })).statusCode).toBe(
      401,
    );
  });

  it('agrega cartões, canais, lojas e série diária no período', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/summary?from=${FROM}&to=${TO}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const s = res.json<SalesSummary>();
    expect(s.totals).toEqual({
      commissionApproved: 11,
      commissionPending: 7,
      sales: 4,
      declined: 1,
      clicks: 7,
      conversion: 4 / 7,
    });
    expect(s.currencies).toEqual(['BRL']);

    const byName = Object.fromEntries(s.byChannel.map((r) => [r.channelName, r]));
    expect(byName['Grupo A']).toMatchObject({
      channelId: gA,
      channelKind: 'WHATSAPP',
      trackCode: 'wAAAA1',
      clicks: 4,
      sales: 2,
      commissionApproved: 10,
      commissionPending: 5,
      conversion: 0.5,
    });
    expect(byName['Grupo B']).toMatchObject({ clicks: 1, sales: 0, conversion: 0 });
    expect(byName['Canal TG']).toMatchObject({
      channelKind: 'TELEGRAM',
      clicks: 0,
      sales: 1,
      conversion: null,
    });
    expect(byName['Sem canal identificado']).toMatchObject({
      channelId: null,
      clicks: 2,
      sales: 1,
      commissionApproved: 1,
    });
    expect(s.byChannel[0]!.channelName).toBe('Grupo A');

    const adv = Object.fromEntries(s.byAdvertiser.map((r) => [r.advertiserId, r]));
    expect(adv['9999']).toMatchObject({
      advertiserName: 'Loja A',
      sales: 3,
      commissionApproved: 11,
      commissionPending: 2,
    });
    expect(adv['8888']).toMatchObject({ sales: 1, commissionPending: 5 });

    expect(s.daily).toEqual([
      { date: '2026-11-01', sales: 1, commission: 10 },
      { date: '2026-11-02', sales: 1, commission: 5 },
      { date: '2026-11-03', sales: 2, commission: 3 },
    ]);
  });

  it('intervalo inválido → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sales/summary?from=${TO}&to=${FROM}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /sales', () => {
  it('lista as vendas do período, mais recentes primeiro, com filtro de status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?from=${FROM}&to=${TO}`,
      headers: { cookie },
    });
    const list = res.json<SalesList>();
    expect(list.total).toBe(5);
    expect(list.items.map((i) => i.externalId)).toEqual(['s5', 's4', 's3', 's2', 's1']);
    expect(list.items[1]).toMatchObject({
      channelName: 'Canal TG',
      commissionAmount: 2,
      status: 'PENDING',
    });

    const approved = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?from=${FROM}&to=${TO}&status=APPROVED`,
      headers: { cookie },
    });
    expect(approved.json<SalesList>().items.map((i) => i.externalId)).toEqual(['s5', 's1']);
  });
});

describe('webhook da Awin (configuração)', () => {
  it('GET gera o token na primeira vez e devolve a URL; rotate troca o token', async () => {
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/awin-webhook',
      headers: { cookie, host: 'painel.test', 'x-forwarded-proto': 'https' },
    });
    expect(first.statusCode).toBe(200);
    const info = first.json<{ url: string; path: string }>();
    const row = await prisma.setting.findFirstOrThrow({
      where: { tenantId: t.tenantId, key: AWIN_WEBHOOK_TOKEN_KEY },
    });
    expect(typeof row.value).toBe('string');
    expect(String(row.value)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(info.path).toBe(`/api/v1/webhooks/awin/${row.value}`);
    expect(info.url.endsWith(info.path)).toBe(true);

    const again = await app.inject({
      method: 'GET',
      url: '/api/v1/sales/awin-webhook',
      headers: { cookie },
    });
    expect(again.json<{ path: string }>().path).toBe(info.path);

    const rotated = await app.inject({
      method: 'POST',
      url: '/api/v1/sales/awin-webhook/rotate',
      headers: { cookie },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json<{ path: string }>().path).not.toBe(info.path);
  });
});
