import type { TenantClient } from '@afilados/db';
import {
  findBestProductMatch,
  normalizeProductTitle,
  listingConflictsWithMaster,
  stripScraperSuffix,
  MAX_MATCH_PRICE_RATIO,
  type MatchingCandidate,
} from '@afilados/core';
import { createMasterProduct, recomputeMasterMetrics } from './price-engine';

export interface RepairOptions {
  /** false (padrão) só simula: nada é gravado. */
  apply?: boolean;
}

export interface RepairMove {
  listingId: string;
  externalId: string;
  listingTitle: string;
  price: number;
  fromMasterId: string;
  fromTitle: string;
  /** Produto existente que recebe a listagem, ou null quando ganha um produto novo. */
  toMasterId: string | null;
  toTitle: string;
  reason: 'variante' | 'preco';
}

export interface RepairReport {
  applied: boolean;
  /** Produtos com mais de uma listagem analisados. */
  mastersScanned: number;
  /** Produtos de onde saiu ao menos uma listagem. */
  mastersAffected: number;
  /** Produtos sem nenhuma listagem compatível com o título (deixados como estão). */
  mastersWithoutAnchor: number;
  newMasters: number;
  moves: RepairMove[];
  /** Páginas cujo título tinha lixo da captura ("null menos 21 preço atual…", "23 offOferta…"). */
  titlesCleaned: { masterId: string; from: string; to: string }[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function priceRatio(a: number, b: number): number {
  return a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) : 1;
}

/**
 * Separa listagens de produtos diferentes que o match antigo juntou na mesma página.
 *
 * Para cada produto com mais de uma listagem: a listagem é incompatível quando o título dela
 * conflita com o do produto (variante/EAN) ou quando o preço passa de 1.8× a mediana das
 * listagens compatíveis. A incompatível é re-casada contra os outros produtos (inclusive os
 * criados nesta rodada) ou ganha produto novo; a listagem é movida com o histórico dela.
 * As métricas dos produtos envolvidos são recalculadas. Sem `apply`, só simula.
 */
export async function repairDealMatches(
  db: TenantClient,
  tenantId: string,
  opts: RepairOptions = {},
): Promise<RepairReport> {
  const apply = opts.apply === true;
  const report: RepairReport = {
    applied: apply,
    mastersScanned: 0,
    mastersAffected: 0,
    mastersWithoutAnchor: 0,
    newMasters: 0,
    moves: [],
    titlesCleaned: [],
  };

  const masters = await db.masterProduct.findMany({
    select: { id: true, title: true, ean: true, brand: true, currentBestPrice: true },
    orderBy: { createdAt: 'asc' },
  });
  const listings = await db.productListing.findMany({
    select: {
      id: true,
      masterProductId: true,
      externalId: true,
      title: true,
      currentPrice: true,
      imageUrl: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const byMaster = new Map<string, typeof listings>();
  for (const l of listings) {
    const group = byMaster.get(l.masterProductId) ?? [];
    group.push(l);
    byMaster.set(l.masterProductId, group);
  }

  // Candidatos para re-casar; os produtos novos desta rodada entram aqui também, para que duas
  // listagens do mesmo produto saiam juntas (no dry-run com id provisório).
  const candidates: MatchingCandidate[] = masters.map((m) => ({
    id: m.id,
    title: m.title,
    ean: m.ean,
    brand: m.brand,
    currentBestPrice: Number(m.currentBestPrice),
  }));
  const touched = new Set<string>();

  // Índice palavra → candidatos: com centenas de milhares de páginas, comparar cada oferta com
  // todas seria lento demais. Só entram candidatos que dividem ao menos 2 palavras do título.
  const tokenIndex = new Map<string, Set<number>>();
  const indexCandidate = (pos: number) => {
    for (const t of new Set(normalizeProductTitle(candidates[pos]!.title).tokens)) {
      const set = tokenIndex.get(t) ?? new Set<number>();
      set.add(pos);
      tokenIndex.set(t, set);
    }
  };
  candidates.forEach((_, i) => indexCandidate(i));
  const MAX_SHORTLIST = 400;
  const shortlist = (title: string, excludeId: string): MatchingCandidate[] => {
    const hits = new Map<number, number>();
    for (const t of new Set(normalizeProductTitle(title).tokens)) {
      const set = tokenIndex.get(t);
      // Palavra comum demais ("de", "preto", "smartphone") não ajuda a filtrar.
      if (!set || set.size > 5000) continue;
      for (const pos of set) hits.set(pos, (hits.get(pos) ?? 0) + 1);
    }
    return [...hits.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SHORTLIST)
      .map(([pos]) => candidates[pos]!)
      .filter((c) => c.id !== excludeId);
  };

  for (const master of masters) {
    const group = byMaster.get(master.id) ?? [];
    if (group.length < 2) continue;
    report.mastersScanned += 1;

    const titleOk = group.filter((l) => !listingConflictsWithMaster({ title: l.title }, master));
    if (titleOk.length === 0) {
      report.mastersWithoutAnchor += 1;
      continue;
    }
    const ref = median(titleOk.map((l) => Number(l.currentPrice)));

    const misplaced: { listing: (typeof group)[number]; reason: RepairMove['reason'] }[] = [];
    for (const l of group) {
      if (!titleOk.includes(l)) misplaced.push({ listing: l, reason: 'variante' });
      else if (priceRatio(Number(l.currentPrice), ref) > MAX_MATCH_PRICE_RATIO) {
        misplaced.push({ listing: l, reason: 'preco' });
      }
    }
    if (misplaced.length === 0) continue;
    report.mastersAffected += 1;
    touched.add(master.id);

    for (const { listing, reason } of misplaced) {
      const price = Number(listing.currentPrice);
      const match = findBestProductMatch(
        { title: listing.title, ean: null, brand: normalizeProductTitle(listing.title).brand ?? null, price },
        shortlist(listing.title, master.id),
      );

      let toMasterId: string;
      let toTitle: string;
      if (match) {
        toMasterId = match.id;
        toTitle = match.title;
      } else {
        report.newMasters += 1;
        toTitle = normalizeProductTitle(listing.title).cleanTitle;
        toMasterId = apply
          ? await createMasterProduct(db, tenantId, {
              title: listing.title,
              ean: null,
              images: listing.imageUrl ? [listing.imageUrl] : [],
              price,
            })
          : `novo-${report.newMasters}`;
        candidates.push({ id: toMasterId, title: toTitle, ean: null, brand: null, currentBestPrice: price });
        indexCandidate(candidates.length - 1);
      }

      report.moves.push({
        listingId: listing.id,
        externalId: listing.externalId,
        listingTitle: listing.title,
        price,
        fromMasterId: master.id,
        fromTitle: master.title,
        toMasterId: match ? match.id : null,
        toTitle,
        reason,
      });
      if (apply) {
        await db.productListing.updateMany({
          where: { id: listing.id },
          data: { masterProductId: toMasterId },
        });
        touched.add(toMasterId);
      }
    }
  }

  // Título da página com lixo da captura: limpa título e cleanTitle (o slug fica, links já postados).
  for (const master of masters) {
    const stripped = stripScraperSuffix(master.title);
    if (stripped === master.title.trim() || stripped.length === 0) continue;
    const to = normalizeProductTitle(stripped).cleanTitle;
    if (!to || to === master.title) continue;
    report.titlesCleaned.push({ masterId: master.id, from: master.title, to });
    if (apply) {
      await db.masterProduct.updateMany({
        where: { id: master.id },
        data: { title: to, cleanTitle: to },
      });
    }
  }

  if (apply) {
    for (const id of touched) await recomputeMasterMetrics(db, id);
  }
  return report;
}
