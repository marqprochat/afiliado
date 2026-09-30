import type { AutomationRule } from '@afilados/db';

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Mesmas regras do worker (apps/worker/src/automation/discovery.ts): a keyword da regra é
// obrigatória — cada palavra dela precisa aparecer no título, ignorando acentos e caixa.
export function matchesDiscoveryFilters(
  p: { title: string; price: number; discountPct?: number | undefined },
  rule: Pick<AutomationRule, 'blockedKeywords' | 'minDiscountPct' | 'minPrice' | 'maxPrice'>,
  keyword: string,
): boolean {
  const title = normalizeText(p.title);
  const tokens = normalizeText(keyword).split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => title.includes(t))) return false;
  if (rule.blockedKeywords.some((k) => title.includes(normalizeText(k)))) return false;
  if (rule.minDiscountPct != null && (p.discountPct ?? 0) < rule.minDiscountPct) return false;
  if (rule.minPrice != null && p.price < Number(rule.minPrice)) return false;
  if (rule.maxPrice != null && p.price > Number(rule.maxPrice)) return false;
  return true;
}
