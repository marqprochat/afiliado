/** Fator aplicado ao EPC quando o programa não informa a taxa de aprovação. */
export const AWIN_DEFAULT_APPROVAL_FACTOR = 0.8;

type Numeric = number | string | { toString(): string } | null | undefined;

function toNum(v: Numeric): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Score do programa: `epc × (aprovação/100)`; sem aprovação usa `epc × 0,8`; sem EPC → `null`
 * (o programa vai para o fim do ranking).
 */
export function computeProgrammeScore(kpi: {
  epc: number | null;
  approvalPercentage: number | null;
}): number | null {
  if (kpi.epc === null || !Number.isFinite(kpi.epc)) return null;
  const factor =
    kpi.approvalPercentage !== null && Number.isFinite(kpi.approvalPercentage)
      ? kpi.approvalPercentage / 100
      : AWIN_DEFAULT_APPROVAL_FACTOR;
  return kpi.epc * factor;
}

export interface RankableProgrammeStats {
  score: Numeric;
  conversionRate: Numeric;
  averagePaymentTime: Numeric;
}

/**
 * Ordem do ranking: score maior primeiro (null no fim); desempate pela conversão maior e depois
 * pelo prazo médio de pagamento menor (ausentes perdem o desempate).
 */
export function compareProgrammeStats(
  a: RankableProgrammeStats,
  b: RankableProgrammeStats,
): number {
  const desc = (x: number | null, y: number | null) =>
    x === y ? 0 : x === null ? 1 : y === null ? -1 : y - x;
  const asc = (x: number | null, y: number | null) =>
    x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y;
  return (
    desc(toNum(a.score), toNum(b.score)) ||
    desc(toNum(a.conversionRate), toNum(b.conversionRate)) ||
    asc(toNum(a.averagePaymentTime), toNum(b.averagePaymentTime))
  );
}
