import { describe, it, expect } from 'vitest';
import { compareProgrammeStats, computeProgrammeScore } from '../src/awin/programme-score';

describe('computeProgrammeScore', () => {
  it('epc × aprovação/100', () => {
    expect(computeProgrammeScore({ epc: 0.5, approvalPercentage: 80 })).toBeCloseTo(0.4);
  });
  it('sem aprovação usa epc × 0,8', () => {
    expect(computeProgrammeScore({ epc: 1, approvalPercentage: null })).toBeCloseTo(0.8);
  });
  it('sem epc → null', () => {
    expect(computeProgrammeScore({ epc: null, approvalPercentage: 90 })).toBeNull();
  });
});

describe('compareProgrammeStats', () => {
  const base = { conversionRate: null, averagePaymentTime: null };
  it('score maior primeiro e null no fim', () => {
    const list = [
      { id: 'a', score: null, ...base },
      { id: 'b', score: 0.2, ...base },
      { id: 'c', score: 0.9, ...base },
    ];
    expect(list.sort(compareProgrammeStats).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('desempata por conversão maior e depois prazo de pagamento menor', () => {
    const list = [
      { id: 'a', score: 0.5, conversionRate: 2, averagePaymentTime: 30 },
      { id: 'b', score: 0.5, conversionRate: 3, averagePaymentTime: 90 },
      { id: 'c', score: 0.5, conversionRate: 2, averagePaymentTime: 10 },
      { id: 'd', score: 0.5, conversionRate: null, averagePaymentTime: 1 },
    ];
    expect(list.sort(compareProgrammeStats).map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('aceita Decimal/strings numéricas (vindas do Prisma)', () => {
    const list = [
      { id: 'a', score: '0.1', conversionRate: null, averagePaymentTime: null },
      { id: 'b', score: { toString: () => '0.3' }, conversionRate: null, averagePaymentTime: null },
    ];
    expect(list.sort(compareProgrammeStats).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
