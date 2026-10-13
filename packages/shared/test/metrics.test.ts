import { describe, it, expect } from 'vitest';
import {
  customRange,
  metricsDelta,
  metricsQuerySchema,
  periodRange,
  previousRange,
  spAddDays,
  spDayKey,
  spDayKeysInRange,
  spMidnight,
} from '../src/metrics';

describe('metricsQuerySchema', () => {
  it('aceita from/to ISO e groupJid opcional', () => {
    const q = metricsQuerySchema.parse({
      from: '2026-10-01T03:00:00.000Z',
      to: '2026-10-31T03:00:00.000Z',
    });
    expect(q.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(q.to.toISOString()).toBe('2026-10-31T03:00:00.000Z');
    expect(q.groupJid).toBeUndefined();
    const g = metricsQuerySchema.parse({
      from: '2026-10-01T00:00:00-03:00',
      to: '2026-10-02T00:00:00-03:00',
      groupJid: '123@g.us',
    });
    expect(g.groupJid).toBe('123@g.us');
    expect(g.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('exige from e to', () => {
    expect(() => metricsQuerySchema.parse({ to: '2026-10-02T00:00:00Z' })).toThrow();
    expect(() => metricsQuerySchema.parse({ from: '2026-10-02T00:00:00Z' })).toThrow();
  });

  it('rejeita datas inválidas', () => {
    expect(() => metricsQuerySchema.parse({ from: 'ontem', to: '2026-10-02T00:00:00Z' })).toThrow();
  });

  it('rejeita to <= from', () => {
    expect(() =>
      metricsQuerySchema.parse({ from: '2026-10-02T00:00:00Z', to: '2026-10-02T00:00:00Z' }),
    ).toThrow(/posterior/);
  });

  it('aceita 366 dias e rejeita mais', () => {
    expect(() =>
      metricsQuerySchema.parse({ from: '2025-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }),
    ).not.toThrow();
    expect(() =>
      metricsQuerySchema.parse({ from: '2025-01-01T00:00:00Z', to: '2026-01-02T00:00:00.001Z' }),
    ).toThrow(/366/);
  });
});

describe('helpers de fuso America/Sao_Paulo', () => {
  it('spDayKey usa o dia local de SP', () => {
    expect(spDayKey(new Date('2026-01-01T02:00:00Z'))).toBe('2025-12-31');
    expect(spDayKey(new Date('2026-01-01T03:00:00Z'))).toBe('2026-01-01');
  });

  it('spMidnight devolve a meia-noite de SP em UTC', () => {
    expect(spMidnight('2026-10-13').toISOString()).toBe('2026-10-13T03:00:00.000Z');
  });

  it('spAddDays atravessa mês e ano', () => {
    expect(spAddDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(spAddDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('spDayKeysInRange lista os dias com to exclusivo', () => {
    expect(spDayKeysInRange(spMidnight('2025-12-30'), spMidnight('2026-01-02'))).toEqual([
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
    ]);
  });

  it('periodRange termina na meia-noite de amanhã (SP)', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    const r = periodRange('7d', now);
    expect(r.from.toISOString()).toBe('2026-10-07T03:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    const today = periodRange('today', new Date('2026-10-14T01:00:00Z'));
    expect(today.from.toISOString()).toBe('2026-10-13T03:00:00.000Z');
    expect(today.to.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    const r30 = periodRange('30d', now);
    expect(spDayKeysInRange(r30.from, r30.to)).toHaveLength(30);
    const r90 = periodRange('90d', now);
    expect(spDayKeysInRange(r90.from, r90.to)).toHaveLength(90);
  });

  it('customRange inclui o último dia', () => {
    const r = customRange('2026-02-01', '2026-02-28');
    expect(r.from.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-03-01T03:00:00.000Z');
  });

  it('previousRange é o período imediatamente anterior de mesmo tamanho', () => {
    const r = previousRange(spMidnight('2026-10-08'), spMidnight('2026-10-15'));
    expect(r.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-08T03:00:00.000Z');
  });
});

describe('metricsDelta', () => {
  it('calcula variação percentual com 1 casa', () => {
    expect(metricsDelta(110, 100)).toEqual({ current: 110, previous: 100, changePct: 10 });
    expect(metricsDelta(2, 3)).toEqual({ current: 2, previous: 3, changePct: -33.3 });
  });
  it('changePct é null quando o anterior é zero', () => {
    expect(metricsDelta(5, 0).changePct).toBeNull();
    expect(metricsDelta(0, 0).changePct).toBeNull();
  });
});
