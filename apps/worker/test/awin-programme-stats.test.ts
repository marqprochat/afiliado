import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { prisma, encryptJson } from '@afilados/db';
import {
  AwinApiError,
  AWIN_LEGACY_API_INTERVAL_MS,
  mapAwinProgrammeDetails,
  type AwinProgramme,
} from '@afilados/marketplaces';
import type { AwinProgrammeStatsJob } from '@afilados/shared';
import { createAwinProgrammeStatsProcessor } from '../src/processors/awin-programme-stats';
import { AWIN_TOKEN_ERROR } from '../src/processors/coupon-sync';

const NOW = new Date('2026-11-26T06:00:00.000Z');
let tenantId: string;
let childId: string;
let connId: string;

const job = (data: Partial<AwinProgrammeStatsJob> = {}) =>
  ({ data: { tenantId, trigger: 'schedule', ...data } }) as Job<AwinProgrammeStatsJob>;

const prog = (id: number, name: string): AwinProgramme => ({
  id,
  name,
  displayUrl: `https://${name.toLowerCase().replace(/\s+/g, '')}.com.br`,
});

const details = (id: number, name: string, kpi: Record<string, unknown>) =>
  mapAwinProgrammeDetails({
    programmeInfo: { id, name, currencyCode: 'BRL' },
    kpi,
    commissionRange: [{ min: 2, max: 6, type: 'percentage' }],
  });

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'awin-programme-stats' } })).id;
  childId = (
    await prisma.tenant.create({
      data: { name: 'awin-programme-stats-child', parentTenantId: tenantId },
    })
  ).id;
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
});

beforeEach(async () => {
  await prisma.awinProgrammeStats.deleteMany({ where: { tenantId } });
  await prisma.marketplaceConnection.update({
    where: { id: connId },
    data: { status: 'OK', lastError: null },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: childId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('awin-programme-stats', () => {
  it('busca os detalhes um a um respeitando o intervalo e grava com score', async () => {
    const list = vi.fn(async () => [prog(1, 'Loja A'), prog(2, 'Loja B')]);
    const get = vi.fn(async (_c: unknown, id: string | number) =>
      Number(id) === 1
        ? details(1, 'Loja A', { epc: '0.50', approvalPercentage: '80', conversionRate: 2 })
        : details(2, 'Loja B', { epc: 1, averagePaymentTime: 30 }),
    );
    const sleep = vi.fn(async () => {});
    const run = createAwinProgrammeStatsProcessor({
      listAwinProgrammes: list,
      getAwinProgrammeDetails: get,
      sleep,
      now: () => NOW,
    });

    const res = await run(job());

    expect(res).toMatchObject({ ok: true, upserted: 2, removed: 0, failed: 0 });
    expect(list).toHaveBeenCalledWith(
      { publisherId: '12345', offersApiToken: 'tok' },
      { relationship: 'joined' },
    );
    expect(get).toHaveBeenCalledTimes(2);
    // Uma pausa antes de cada chamada de detalhes (a listagem também conta no limite).
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(AWIN_LEGACY_API_INTERVAL_MS);
    expect(AWIN_LEGACY_API_INTERVAL_MS).toBeGreaterThanOrEqual(3_100);

    const rows = await prisma.awinProgrammeStats.findMany({
      where: { tenantId },
      orderBy: { advertiserId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ advertiserId: '1', name: 'Loja A', currency: 'BRL' });
    expect(Number(rows[0]!.score)).toBeCloseTo(0.4);
    expect(Number(rows[0]!.commissionMax)).toBe(6);
    expect(Number(rows[1]!.score)).toBeCloseTo(0.8);
    expect(rows[1]!.averagePaymentTime).toBe(30);
    expect(rows[1]!.fetchedAt.toISOString()).toBe(NOW.toISOString());
  });

  it('atualiza os existentes e remove os que saíram da lista joined', async () => {
    await prisma.awinProgrammeStats.createMany({
      data: [
        { tenantId, advertiserId: '1', name: 'Antigo', fetchedAt: new Date(0) },
        { tenantId, advertiserId: '9', name: 'Saiu', fetchedAt: new Date(0) },
      ],
    });
    const run = createAwinProgrammeStatsProcessor({
      listAwinProgrammes: async () => [prog(1, 'Loja A')],
      getAwinProgrammeDetails: async () => details(1, 'Loja A', { epc: 0.3 }),
      sleep: async () => {},
      now: () => NOW,
    });
    const res = await run(job());
    expect(res).toMatchObject({ ok: true, upserted: 1, removed: 1 });
    const rows = await prisma.awinProgrammeStats.findMany({ where: { tenantId } });
    expect(rows.map((r) => [r.advertiserId, r.name])).toEqual([['1', 'Loja A']]);
    expect(Number(rows[0]!.score)).toBeCloseTo(0.24);
  });

  it('falha pontual nos detalhes não derruba os demais nem apaga a linha antiga', async () => {
    await prisma.awinProgrammeStats.create({
      data: { tenantId, advertiserId: '2', name: 'Loja B', epc: 0.7, fetchedAt: new Date(0) },
    });
    const run = createAwinProgrammeStatsProcessor({
      listAwinProgrammes: async () => [prog(1, 'Loja A'), prog(2, 'Loja B')],
      getAwinProgrammeDetails: async (_c, id) => {
        if (Number(id) === 2) throw new AwinApiError('HTTP 500', 'AWIN_ERROR');
        return details(1, 'Loja A', { epc: 0.3 });
      },
      sleep: async () => {},
      now: () => NOW,
    });
    const res = await run(job());
    expect(res).toMatchObject({ ok: true, upserted: 1, removed: 0, failed: 1 });
    const kept = await prisma.awinProgrammeStats.findFirst({
      where: { tenantId, advertiserId: '2' },
    });
    expect(Number(kept!.epc)).toBeCloseTo(0.7);
  });

  it('401 marca a conexão com AWIN_TOKEN_ERROR, não remove nada e o sucesso seguinte limpa', async () => {
    await prisma.awinProgrammeStats.create({
      data: { tenantId, advertiserId: '5', name: 'Fica', fetchedAt: new Date(0) },
    });
    const unauthorized = createAwinProgrammeStatsProcessor({
      listAwinProgrammes: async () => [prog(1, 'Loja A')],
      getAwinProgrammeDetails: async () => {
        throw new AwinApiError('token', 'AWIN_UNAUTHORIZED');
      },
      sleep: async () => {},
      now: () => NOW,
    });
    const res = await unauthorized(job());
    expect(res.ok).toBe(false);
    const conn = await prisma.marketplaceConnection.findUnique({ where: { id: connId } });
    expect(conn).toMatchObject({ status: 'ERROR', lastError: AWIN_TOKEN_ERROR });
    expect(await prisma.awinProgrammeStats.count({ where: { tenantId } })).toBe(1);

    const ok = createAwinProgrammeStatsProcessor({
      listAwinProgrammes: async () => [],
      getAwinProgrammeDetails: async () => null,
      sleep: async () => {},
      now: () => NOW,
    });
    expect((await ok(job())).ok).toBe(true);
    const cleared = await prisma.marketplaceConnection.findUnique({ where: { id: connId } });
    expect(cleared).toMatchObject({ status: 'OK', lastError: null });
  });

  it('não roda para afiliados (compartilham o publisher do dono)', async () => {
    const list = vi.fn(async () => []);
    const run = createAwinProgrammeStatsProcessor({
      listAwinProgrammes: list,
      sleep: async () => {},
    });
    const res = await run(job({ tenantId: childId }));
    expect(res).toMatchObject({ ok: true, skipped: 'affiliate' });
    expect(list).not.toHaveBeenCalled();
  });
});
