import { describe, it, expect } from 'vitest';
import { awinTokenDaysLeft } from '../src/lib/marketplaces';

// 2026-11-25 12:00 em São Paulo = 15:00Z
const noon = new Date('2026-11-25T15:00:00.000Z');

describe('awinTokenDaysLeft', () => {
  it('0 quando vence hoje', () => expect(awinTokenDaysLeft('2026-11-25', noon)).toBe(0));
  it('positivo no futuro', () => {
    expect(awinTokenDaysLeft('2026-11-26', noon)).toBe(1);
    expect(awinTokenDaysLeft('2026-12-25', noon)).toBe(30);
  });
  it('negativo quando vencido', () => expect(awinTokenDaysLeft('2026-11-20', noon)).toBe(-5));
  it('null sem data ou inválida', () => {
    expect(awinTokenDaysLeft(undefined, noon)).toBeNull();
    expect(awinTokenDaysLeft(null, noon)).toBeNull();
    expect(awinTokenDaysLeft('', noon)).toBeNull();
    expect(awinTokenDaysLeft('25/11/2026', noon)).toBeNull();
    expect(awinTokenDaysLeft('2026-02-31', noon)).toBeNull();
  });
  it('vira o dia no fuso de São Paulo, não em UTC', () => {
    // 02:30Z do dia 26 ainda é 23:30 do dia 25 em SP
    expect(awinTokenDaysLeft('2026-11-25', new Date('2026-11-26T02:30:00.000Z'))).toBe(0);
    // 03:00Z do dia 26 já é 00:00 do dia 26 em SP
    expect(awinTokenDaysLeft('2026-11-25', new Date('2026-11-26T03:00:00.000Z'))).toBe(-1);
  });
});
