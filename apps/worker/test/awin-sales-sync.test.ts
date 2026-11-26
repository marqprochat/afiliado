import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Job } from 'bullmq';
import { prisma, encryptJson } from '@afilados/db';
import { AwinApiError, mapAwinTransaction, type AwinTransaction } from '@afilados/marketplaces';
import type { AwinSalesSyncJob } from '@afilados/shared';
import { createAwinSalesSyncProcessor } from '../src/processors/awin-sales-sync';
import { AWIN_TOKEN_ERROR } from '../src/processors/coupon-sync';

const NOW = new Date('2026-11-25T12:00:00.000Z');
let tenantId: string;
let connId: string;
let groupId: string;

const job = (data: Partial<AwinSalesSyncJob> = {}) =>
  ({ data: { tenantId, windowDays: 7, trigger: 'schedule', ...data } }) as Job<AwinSalesSyncJob>;

const tx = (over: Record<string, unknown> = {}): AwinTransaction =>
  mapAwinTransaction(
    {
      id: 'sync-1',
      advertiserId: 9999,
      commissionStatus: 'pending',
      commissionAmount: { amount: 10, currency: 'BRL' },
      saleAmount: { amount: 100, currency: 'BRL' },
      clickRefs: { clickRef: 'aff', clickRef2: 'wSync1', clickRef3: 'loteX' },
      transactionDate: '2026-11-24T10:00:00',
      ...over,
    },
    { now: NOW },
  )!;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-sales-sync' } })).id;
  connId = (
    await prisma.marketplaceConnection.create({
      data: {
        tenantId,
        kind: 'AWIN',
        status: 'OK',
        encryptedCredentials: encryptJson({
          feedListUrl: 'https://ui.awin.com/f',
          feedIds: [],
          publisherId: '12345',
          offersApiToken: 'tok',
        }),
      },
    })
  ).id;
  const session = await prisma.waSession.create({
    data: { tenantId, label: 's', status: 'CONNECTED' },
  });
  groupId = (
    await prisma.waGroup.create({
      data: {
        tenantId,
        sessionId: session.id,
        jid: 'sync@g.us',
        name: 'Grupo Sync',
        trackCode: 'wSync1',
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('awin-sales-sync', () => {
  it('busca a janela de N dias e grava as vendas com o canal resolvido', async () => {
    const list = vi.fn(async () => [tx()]);
    const run = createAwinSalesSyncProcessor({ listAwinTransactions: list, now: () => NOW });
    const res = await run(job());
    expect(res).toMatchObject({ ok: true, created: 1, updated: 0 });
    expect(list).toHaveBeenCalledWith(
      { publisherId: '12345', offersApiToken: 'tok' },
      {
        startDate: new Date('2026-11-18T12:00:00.000Z'),
        endDate: NOW,
        dateType: 'transaction',
      },
    );
    const sale = await prisma.affiliateSale.findFirstOrThrow({ where: { tenantId } });
    expect(sale).toMatchObject({
      externalId: 'sync-1',
      channelId: groupId,
      channelKind: 'WHATSAPP',
      batchId: 'loteX',
      source: 'API',
    });
  });

  it('é idempotente e atualiza o status na rodada seguinte (janela de 31 dias)', async () => {
    const list = vi.fn(async () => [tx({ commissionStatus: 'approved' })]);
    const run = createAwinSalesSyncProcessor({ listAwinTransactions: list, now: () => NOW });
    const res = await run(job({ windowDays: 31 }));
    expect(res).toMatchObject({ ok: true, created: 0, updated: 1 });
    expect(await prisma.affiliateSale.count({ where: { tenantId } })).toBe(1);
    expect((await prisma.affiliateSale.findFirstOrThrow({ where: { tenantId } })).status).toBe(
      'APPROVED',
    );
    const call = list.mock.calls[0] as unknown as [unknown, { startDate: Date }];
    expect(call[1].startDate.toISOString()).toBe('2026-10-25T12:00:00.000Z');
  });

  it('401 marca a conexão com AWIN_TOKEN_ERROR; o próximo sucesso limpa', async () => {
    const fail = createAwinSalesSyncProcessor({
      listAwinTransactions: async () => {
        throw new AwinApiError('x', 'AWIN_UNAUTHORIZED');
      },
      now: () => NOW,
    });
    const res = await fail(job());
    expect(res).toMatchObject({ ok: false });
    let conn = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(conn).toMatchObject({ status: 'ERROR', lastError: AWIN_TOKEN_ERROR });

    const ok = createAwinSalesSyncProcessor({
      listAwinTransactions: async () => [],
      now: () => NOW,
    });
    await ok(job());
    conn = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(conn).toMatchObject({ status: 'OK', lastError: null });
  });

  it('afiliado (credenciais herdadas) não sincroniza', async () => {
    const child = await prisma.tenant.create({
      data: { name: 'sync-child', parentTenantId: tenantId },
    });
    try {
      const list = vi.fn(async () => [tx()]);
      const run = createAwinSalesSyncProcessor({ listAwinTransactions: list, now: () => NOW });
      const res = await run(job({ tenantId: child.id }));
      expect(res).toMatchObject({ ok: true, skipped: 'affiliate' });
      expect(list).not.toHaveBeenCalled();
    } finally {
      await prisma.tenant.deleteMany({ where: { id: child.id } });
    }
  });

  it('sem token da Awin não sincroniza', async () => {
    const other = await prisma.tenant.create({ data: { name: 'sync-no-token' } });
    try {
      await prisma.marketplaceConnection.create({
        data: {
          tenantId: other.id,
          kind: 'AWIN',
          encryptedCredentials: encryptJson({ feedListUrl: 'x', feedIds: [], publisherId: '1' }),
        },
      });
      const list = vi.fn(async () => []);
      const run = createAwinSalesSyncProcessor({ listAwinTransactions: list, now: () => NOW });
      expect(await run(job({ tenantId: other.id }))).toMatchObject({ skipped: 'no-credentials' });
      expect(list).not.toHaveBeenCalled();
    } finally {
      await prisma.tenant.deleteMany({ where: { id: other.id } });
    }
  });
});
