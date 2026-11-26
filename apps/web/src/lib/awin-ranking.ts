/** EPC na moeda do programa (padrão BRL), com espaço comum entre símbolo e valor. */
export function formatEpc(epc: number | null | undefined, currency: string | null | undefined) {
  if (epc === null || epc === undefined || !Number.isFinite(epc)) return '—';
  let text: string;
  try {
    text = epc.toLocaleString('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    text = epc.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  return text.replace(/\s/g, ' ');
}

/** Rótulo da loja no seletor da busca: "Drogal BR · EPC R$ 0,42" (só o nome sem indicador). */
export function awinStoreLabel(store: {
  name: string;
  epc: number | null;
  currency: string | null;
}): string {
  return store.epc === null
    ? store.name
    : `${store.name} · EPC ${formatEpc(store.epc, store.currency)}`;
}

const norm = (v: string) => v.trim().toLowerCase();

/**
 * Ordena os produtos pela posição da loja no ranking (lista de nomes já ordenada por score).
 * Dentro da mesma loja mantém a ordem atual; lojas fora do ranking vão para o fim.
 */
export function sortByStoreRank<T extends { shopName: string | null }>(
  products: T[],
  rankedStoreNames: string[],
): T[] {
  const rank = new Map<string, number>();
  rankedStoreNames.forEach((name, i) => {
    if (!rank.has(norm(name))) rank.set(norm(name), i);
  });
  const pos = (p: T) =>
    (p.shopName ? rank.get(norm(p.shopName)) : undefined) ?? Number.POSITIVE_INFINITY;
  return products
    .map((p, i) => ({ p, i, r: pos(p) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r < b.r ? -1 : 1))
    .map(({ p }) => p);
}
