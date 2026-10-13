import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getProductsMetrics } from '../src/lib/metrics/products';
import { cleanupTenant } from './helpers';
import {
  addProductSend,
  addSendLog,
  createMetricsTenant,
  type MetricsCtx,
} from './metrics-fixtures';

const range = { from: spMidnight('2026-03-01'), to: spMidnight('2026-04-01') };
const IN = '2026-03-10T15:00:00Z';
let ctx: MetricsCtx;
let other: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('products');
  other = await createMetricsTenant('products-other');
  const fone = await addProductSend(ctx, {
    source: 'SHOPEE',
    title: 'Fone',
    groupJids: ['p-g1@g.us', 'p-g2@g.us', 'p-g3@g.us'],
    sentAt: IN,
  });
  // falha do mesmo item em outro grupo não conta
  await addSendLog(ctx, 'p-g9@g.us', IN, 'ERROR', { batchItemId: fone.itemId, error: 'x' });
  await addProductSend(ctx, {
    source: 'AMAZON',
    title: 'Livro',
    groupJids: ['p-g4@g.us'],
    sentAt: IN,
  });
  for (let i = 1; i <= 9; i++) {
    await addProductSend(ctx, {
      source: 'SHOPEE',
      title: `Extra ${i}`,
      groupJids: ['p-x@g.us'],
      sentAt: IN,
    });
  }
  // fora do período
  await addProductSend(ctx, {
    source: 'MERCADOLIVRE',
    title: 'Panela',
    groupJids: ['p-g1@g.us', 'p-g2@g.us'],
    sentAt: '2026-02-01T15:00:00Z',
  });
  await addProductSend(other, {
    source: 'MAGALU',
    title: 'Outro tenant',
    groupJids: ['o@g.us'],
    sentAt: IN,
  });
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getProductsMetrics', () => {
  it('top 10 por envios com sucesso', async () => {
    const m = await getProductsMetrics(ctx.tenantId, range);
    expect(m.top).toHaveLength(10);
    expect(m.top[0]).toMatchObject({
      title: 'Fone',
      source: 'SHOPEE',
      image: 'https://example.com/i.jpg',
      sends: 3,
    });
    expect(m.top.map((p) => p.title)).not.toContain('Panela');
    expect(m.top.map((p) => p.title)).not.toContain('Outro tenant');
  });

  it('distribuição por marketplace', async () => {
    const m = await getProductsMetrics(ctx.tenantId, range);
    expect(m.byMarketplace).toEqual([
      { source: 'SHOPEE', sends: 12 },
      { source: 'AMAZON', sends: 1 },
    ]);
  });

  it('filtra por groupJid', async () => {
    const m = await getProductsMetrics(ctx.tenantId, { ...range, groupJid: 'p-g1@g.us' });
    expect(m.top.map((p) => [p.title, p.sends])).toEqual([['Fone', 1]]);
    expect(m.byMarketplace).toEqual([{ source: 'SHOPEE', sends: 1 }]);
  });

  it('período vazio devolve listas vazias', async () => {
    const m = await getProductsMetrics(ctx.tenantId, {
      from: spMidnight('2030-01-01'),
      to: spMidnight('2030-01-02'),
    });
    expect(m).toEqual({ top: [], byMarketplace: [] });
  });
});
