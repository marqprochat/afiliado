import type { TenantClient } from '@afilados/db';
import { runWithBudget } from '@afilados/marketplaces';
import { resolveAwinImage, type ResolveAwinImage } from './awin-images';

/** Tempo máximo que a página da oferta espera pela imagem substituta. */
const DETAIL_IMAGE_BUDGET_MS = 3_000;

interface DealWithImages {
  id: string;
  imageUrl: string | null;
  images: string[];
  listings: { id: string; source: string; imageUrl: string | null }[];
}

export interface FixDealImagesOptions {
  resolveImage?: ResolveAwinImage;
  budgetMs?: number;
}

/**
 * Página da oferta (`/deals/:slug`): imagem de oferta Awin fora do ar (feed desatualizado) é
 * trocada pela da loja, na resposta e no banco (listagem e, se usava a mesma imagem, o produto).
 * A vitrine não faz isso (seria lento para 24 cards); ela depende deste reparo e do script.
 */
export async function fixAwinDealImages<T extends DealWithImages>(
  db: TenantClient,
  deal: T,
  opts: FixDealImagesOptions = {},
): Promise<T> {
  const awinIds = deal.listings.filter((l) => l.source === 'AWIN' && l.imageUrl).map((l) => l.id);
  if (awinIds.length === 0) return deal;
  const resolveImage = opts.resolveImage ?? resolveAwinImage;
  const rows = await db.productListing.findMany({
    where: { id: { in: awinIds } },
    select: { id: true, imageUrl: true, originalUrl: true, title: true },
  });
  const results = await runWithBudget(
    rows,
    async (row) => {
      const res = await resolveImage({
        imageUrl: row.imageUrl,
        deepLink: row.originalUrl,
        title: row.title,
      });
      if (res.status !== 'resolved' || !res.url || res.url === row.imageUrl) return undefined;
      await db.productListing.updateMany({
        where: { id: row.id, imageUrl: row.imageUrl },
        data: { imageUrl: res.url },
      });
      return { from: row.imageUrl!, to: res.url };
    },
    { concurrency: 6, budgetMs: opts.budgetMs ?? DETAIL_IMAGE_BUDGET_MS },
  );
  const swaps = new Map<string, string>();
  const byListing = new Map<string, string>();
  rows.forEach((row, i) => {
    const r = results[i];
    if (!r) return;
    swaps.set(r.from, r.to);
    byListing.set(row.id, r.to);
  });
  if (swaps.size === 0) return deal;

  const swap = (url: string | null) => (url && swaps.get(url)) || url;
  const images = deal.images.map((u) => swap(u)!);
  const imageUrl = swap(deal.imageUrl);
  if (imageUrl !== deal.imageUrl || images.some((u, i) => u !== deal.images[i])) {
    await db.masterProduct.updateMany({ where: { id: deal.id }, data: { imageUrl, images } });
  }
  return {
    ...deal,
    imageUrl,
    images,
    listings: deal.listings.map((l) =>
      byListing.has(l.id) ? { ...l, imageUrl: byListing.get(l.id)! } : l,
    ),
  };
}
