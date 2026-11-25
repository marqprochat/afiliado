import { describe, it, expect } from 'vitest';
import { awinTokenAlert } from '@/lib/awin-token-alert';

const c = (over: Record<string, unknown>) => ({ kind: 'AWIN' as const, ...over });

describe('awinTokenAlert', () => {
  it('null para outro marketplace, sem data ou longe do vencimento', () => {
    expect(awinTokenAlert(undefined)).toBeNull();
    expect(awinTokenAlert({ kind: 'SHOPEE', awinTokenDaysLeft: 1 })).toBeNull();
    expect(awinTokenAlert(c({ awinTokenDaysLeft: null }))).toBeNull();
    expect(awinTokenAlert(c({}))).toBeNull();
    expect(awinTokenAlert(c({ awinTokenDaysLeft: 8 }))).toBeNull();
  });
  it('amarelo de 0 a 7 dias', () => {
    expect(awinTokenAlert(c({ awinTokenDaysLeft: 0 }))).toEqual({
      tone: 'warn',
      message: 'Token da Awin vence hoje',
    });
    expect(awinTokenAlert(c({ awinTokenDaysLeft: 1 }))?.message).toBe(
      'Token da Awin vence em 1 dia',
    );
    expect(awinTokenAlert(c({ awinTokenDaysLeft: 7 }))).toEqual({
      tone: 'warn',
      message: 'Token da Awin vence em 7 dias',
    });
  });
  it('vermelho quando vencido, com a data em DD/MM/AAAA', () => {
    expect(awinTokenAlert(c({ awinTokenDaysLeft: -2, awinTokenExpiresAt: '2026-11-23' }))).toEqual({
      tone: 'error',
      message: 'Token da Awin venceu em 23/11/2026',
    });
  });
});
