import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { spMidnight } from '@afilados/shared';
import { getAutomationMetrics } from '../src/lib/metrics/automation';
import { cleanupTenant } from './helpers';
import { addCouponSend, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const range = { from: spMidnight('2026-05-01'), to: spMidnight('2026-05-08') };
const T1 = 'a-t1@g.us';
const T2 = 'a-t2@g.us';
let ctx: MetricsCtx;
let other: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('automation');
  other = await createMetricsTenant('automation-other');
  const rule = await prisma.mirrorRule.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      sourceJids: ['src@g.us'],
      targetJids: [T1, T2],
    },
  });
  const mirror = (
    msg: string,
    targetJid: string,
    status: 'MIRRORED' | 'DISCARDED' | 'ERROR',
    at: string,
  ) =>
    prisma.mirrorLog.create({
      data: {
        tenantId: ctx.tenantId,
        ruleId: rule.id,
        sourceJid: 'src@g.us',
        sourceMsgId: msg,
        targetJid,
        status,
        createdAt: new Date(at),
      },
    });
  await mirror('m1', T1, 'MIRRORED', '2026-05-02T12:00:00Z');
  await mirror('m1', T2, 'MIRRORED', '2026-05-02T12:00:00Z');
  await mirror('m2', T1, 'DISCARDED', '2026-05-03T12:00:00Z');
  await mirror('m3', T2, 'ERROR', '2026-05-03T13:00:00Z');
  await mirror('m4', T1, 'MIRRORED', '2026-04-20T12:00:00Z'); // fora do período

  const autoRule = await prisma.automationRule.create({
    data: {
      tenantId: ctx.tenantId,
      name: 'Regra',
      sessionId: ctx.sessionId,
      templateId: ctx.templateId,
      marketplaces: [],
      keywords: [],
      blockedKeywords: [],
      groupJids: [],
    },
  });
  const auto = (action: 'DISCOVERED' | 'DISPATCHED' | 'SKIPPED' | 'ERROR', at: string) =>
    prisma.automationLog.create({
      data: {
        tenantId: ctx.tenantId,
        ruleId: autoRule.id,
        marketplace: 'SHOPEE',
        action,
        createdAt: new Date(at),
      },
    });
  await auto('DISCOVERED', '2026-05-02T10:00:00Z');
  await auto('DISCOVERED', '2026-05-02T11:00:00Z');
  await auto('DISPATCHED', '2026-05-02T12:00:00Z');
  await auto('SKIPPED', '2026-05-04T12:00:00Z');
  await auto('ERROR', '2026-05-05T12:00:00Z');

  const coupon = await prisma.coupon.create({
    data: { tenantId: ctx.tenantId, store: 'SHOPEE', code: 'CHK', description: 'c' },
  });
  const check = (result: 'VALID' | 'INVALID', at: string) =>
    prisma.couponCheck.create({
      data: {
        tenantId: ctx.tenantId,
        couponId: coupon.id,
        result,
        method: 'MANUAL',
        createdAt: new Date(at),
      },
    });
  await check('VALID', '2026-05-02T12:00:00Z');
  await check('VALID', '2026-05-03T12:00:00Z');
  await check('INVALID', '2026-05-03T12:00:00Z');
  await check('VALID', '2026-04-01T12:00:00Z'); // fora do período

  await addCouponSend(ctx, { groupJid: 'a-g1@g.us', sentAt: '2026-05-04T12:00:00Z' });
  await addCouponSend(ctx, { groupJid: 'a-g2@g.us', sentAt: '2026-05-04T13:00:00Z' });

  const otherCoupon = await prisma.coupon.create({
    data: { tenantId: other.tenantId, store: 'SHOPEE', code: 'OTHER', description: 'c' },
  });
  await prisma.couponCheck.create({
    data: {
      tenantId: other.tenantId,
      couponId: otherCoupon.id,
      result: 'VALID',
      method: 'MANUAL',
      createdAt: new Date('2026-05-02T12:00:00Z'),
    },
  });
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getAutomationMetrics', () => {
  it('espelhamento, automação e cupons do período', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, range);
    expect(m.mirror).toEqual({ captured: 3, mirrored: 2, discarded: 1, errors: 1 });
    expect(m.automation).toEqual({ discovered: 2, dispatched: 1, skipped: 1, errors: 1 });
    expect(m.coupons).toEqual({ validated: 2, propagated: 2 });
  });

  it('série diária de espelhadas e disparadas', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, range);
    expect(m.daily).toHaveLength(7);
    expect(m.daily.find((d) => d.date === '2026-05-02')).toEqual({
      date: '2026-05-02',
      mirrored: 2,
      dispatched: 1,
    });
    expect(m.daily.find((d) => d.date === '2026-05-06')).toEqual({
      date: '2026-05-06',
      mirrored: 0,
      dispatched: 0,
    });
  });

  it('groupJid filtra o destino do espelhamento e os envios de cupom', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, { ...range, groupJid: T1 });
    expect(m.mirror).toEqual({ captured: 2, mirrored: 1, discarded: 1, errors: 0 });
    expect(m.coupons.propagated).toBe(0);
  });

  it('período vazio devolve zeros', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, {
      from: spMidnight('2030-01-01'),
      to: spMidnight('2030-01-02'),
    });
    expect(m.mirror).toEqual({ captured: 0, mirrored: 0, discarded: 0, errors: 0 });
    expect(m.automation).toEqual({ discovered: 0, dispatched: 0, skipped: 0, errors: 0 });
    expect(m.coupons).toEqual({ validated: 0, propagated: 0 });
    expect(m.daily).toEqual([{ date: '2030-01-01', mirrored: 0, dispatched: 0 }]);
  });
});
