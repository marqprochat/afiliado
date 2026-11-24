import type { TenantClient } from '@afilados/db';
import {
  findBestProductMatch,
  normalizeProductTitle,
  productsConflict,
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

  for (const master of masters) {
    const group = byMaster.get(master.id) ?? [];
    if (group.length < 2) continue;
    report.mastersScanned += 1;

    const titleOk = group.filter((l) => !productsConflict({ title: l.title }, master));
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
        candidates.filter((c) => c.id !== master.id),
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

  if (apply) {
    for (const id of touched) await recomputeMasterMetrics(db, id);
  }
  return report;
}
