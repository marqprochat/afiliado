import { describe, it, expect } from 'vitest';
import { filtersToApiQuery, filtersToSearch, parseMetricsFilters } from '@/lib/metrics-filters';

const NOW = new Date('2026-10-13T15:00:00Z');
const parse = (qs: string) => parseMetricsFilters(new URLSearchParams(qs), NOW);

describe('parseMetricsFilters', () => {
  it('usa 30 dias por padrão', () => {
    const f = parse('');
    expect(f.period).toBe('30d');
    expect(f.fromDay).toBe('2026-09-14');
    expect(f.toDay).toBe('2026-10-13');
    expect(f.from.toISOString()).toBe('2026-09-14T03:00:00.000Z');
    expect(f.to.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    expect(f.groupJid).toBeNull();
  });

  it('lê período rápido e grupo', () => {
    const f = parse('period=7d&groupJid=g1%40g.us');
    expect(f.period).toBe('7d');
    expect(f.fromDay).toBe('2026-10-07');
    expect(f.groupJid).toBe('g1@g.us');
  });

  it('lê intervalo personalizado com fim inclusivo', () => {
    const f = parse('period=custom&from=2026-02-01&to=2026-02-28');
    expect(f.period).toBe('custom');
    expect(f.from.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    expect(f.to.toISOString()).toBe('2026-03-01T03:00:00.000Z');
  });

  it.each([
    ['period=custom&from=2026-02-10&to=2026-02-01'],
    ['period=custom&from=2026-02-30&to=2026-03-01'],
    ['period=custom&from=2025-01-01&to=2026-01-02'],
    ['period=custom'],
    ['period=xyz'],
  ])('volta para 30 dias quando inválido: %s', (qs) => {
    expect(parse(qs).period).toBe('30d');
  });
});

describe('serialização', () => {
  it('filtersToSearch omite o padrão', () => {
    expect(filtersToSearch(parse(''))).toBe('');
    expect(filtersToSearch(parse('period=7d&groupJid=g1%40g.us'))).toBe(
      'period=7d&groupJid=g1%40g.us',
    );
    expect(filtersToSearch(parse('period=custom&from=2026-02-01&to=2026-02-28'))).toBe(
      'period=custom&from=2026-02-01&to=2026-02-28',
    );
  });

  it('filtersToApiQuery manda instantes ISO', () => {
    expect(filtersToApiQuery(parse('groupJid=g1%40g.us'))).toBe(
      'from=2026-09-14T03%3A00%3A00.000Z&to=2026-10-14T03%3A00%3A00.000Z&groupJid=g1%40g.us',
    );
  });
});
