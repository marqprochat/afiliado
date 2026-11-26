/**
 * Reparo das imagens de produtos da Awin que saíram do ar (feed do anunciante desatualizado,
 * ex.: Drogal migrou a loja para a VTEX e o feed ainda aponta para io.convertiez.com.br → 404).
 *
 * Verifica as imagens do catálogo Awin (AwinCatalogProduct) e das ofertas Awin do site
 * (ProductListing + MasterProduct): primeiro uma amostra por host (host com a amostra toda no ar
 * é pulado), depois URL a URL. Para cada imagem fora do ar procura a imagem atual na loja (VTEX)
 * sem nunca requisitar o link de rastreio da Awin (loja pelo `ued` ou pelo id do anunciante; slug
 * pelo `ued`, pelo nome do arquivo da imagem ou busca pelo título).
 *
 * Dry-run por padrão (só imprime); `--apply` grava. `--advertiser=<id>` limita a um anunciante;
 * `--limit=<n>` limita quantos registros de cada tabela são lidos.
 *
 *   DATABASE_URL=... pnpm --filter @afilados/db exec tsx ../../scripts/repair-awin-images.ts
 *   DATABASE_URL=... pnpm --filter @afilados/db exec tsx ../../scripts/repair-awin-images.ts --advertiser=68224 --apply
 *
 * Os imports são relativos porque a raiz do monorepo não enxerga os pacotes @afilados/*.
 */
import { prisma } from '../packages/db/src/index';
import {
  isImageAliveCached,
  resolveFallbackImage,
  runWithBudget,
  type ImageFallbackCache,
} from '../packages/marketplaces/src/awin/image-fallback';

const CONCURRENCY = 6;
const HOST_SAMPLE = 3;
const NO_BUDGET = 2 ** 31 - 1;
const EXAMPLES = 10;

function argValue(args: string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '(inválida)';
  }
};

/** Cache em memória: cada URL é verificada uma vez por execução. */
function memoryCache(): ImageFallbackCache {
  const store = new Map<string, string>();
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
  };
}

interface Candidate {
  kind: 'catalog' | 'listing';
  id: string;
  imageUrl: string;
  deepLink: string;
  title: string;
  imageOriginalUrl?: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const advertiser = argValue(args, 'advertiser');
  const limitArg = argValue(args, 'limit');
  const limit = limitArg ? Number(limitArg) : undefined;
  if (limitArg && (!Number.isInteger(limit) || limit! <= 0)) throw new Error('--limit inválido');
  if (advertiser !== undefined && !/^\d+$/.test(advertiser))
    throw new Error('--advertiser inválido');

  console.log(
    `--- Reparo de imagens Awin (${apply ? 'APPLY: gravando' : 'dry-run: nada é gravado'}) ---`,
  );
  const deps = { cache: memoryCache() };

  // Catálogo: só as que ainda não foram trocadas (imageUrl = imagem do feed).
  const catalog = await prisma.awinCatalogProduct.findMany({
    where: { imageUrl: { not: null }, ...(advertiser ? { advertiserId: advertiser } : {}) },
    select: { id: true, imageUrl: true, imageOriginalUrl: true, deepLink: true, title: true },
    ...(limit ? { take: limit } : {}),
  });
  const advertiserRe = advertiser ? new RegExp(`[?&](m|awinmid|mid)=${advertiser}(&|$)`) : null;
  const listings = (
    await prisma.productListing.findMany({
      where: { source: 'AWIN', imageUrl: { not: null } },
      select: { id: true, imageUrl: true, originalUrl: true, title: true },
      ...(limit && !advertiserRe ? { take: limit } : {}),
    })
  )
    .filter((l) => !advertiserRe || advertiserRe.test(l.originalUrl))
    .slice(0, limit ?? undefined);

  const candidates: Candidate[] = [
    ...catalog
      .filter((r) => !(r.imageOriginalUrl && r.imageOriginalUrl !== r.imageUrl))
      .map((r) => ({
        kind: 'catalog' as const,
        id: r.id,
        imageUrl: r.imageUrl!,
        deepLink: r.deepLink,
        title: r.title,
        imageOriginalUrl: r.imageOriginalUrl,
      })),
    ...listings.map((l) => ({
      kind: 'listing' as const,
      id: l.id,
      imageUrl: l.imageUrl!,
      deepLink: l.originalUrl,
      title: l.title,
    })),
  ];
  console.log(
    `${catalog.length} produtos do catálogo, ${listings.length} ofertas do site; ` +
      `${candidates.length} imagens a verificar.`,
  );

  // 1. Amostra por host.
  const byHost = new Map<string, string[]>();
  for (const c of candidates) {
    const urls = byHost.get(hostOf(c.imageUrl)) ?? [];
    if (!urls.includes(c.imageUrl)) urls.push(c.imageUrl);
    byHost.set(hostOf(c.imageUrl), urls);
  }
  const suspectHosts = new Set<string>();
  for (const [host, urls] of byHost) {
    const sample = urls.slice(0, HOST_SAMPLE);
    const alive = await runWithBudget(sample, (u) => isImageAliveCached(u, deps), {
      concurrency: CONCURRENCY,
      budgetMs: NO_BUDGET,
    });
    const dead = alive.filter((a) => a !== true).length;
    console.log(
      `  host ${host}: ${urls.length} imagens, amostra ${dead}/${sample.length} fora do ar`,
    );
    if (dead > 0) suspectHosts.add(host);
  }

  // 2. URL a URL nos hosts suspeitos, e busca da substituta para as que estão fora do ar.
  const suspects = candidates.filter((c) => suspectHosts.has(hostOf(c.imageUrl)));
  const outcomes = await runWithBudget(
    suspects,
    async (c) =>
      resolveFallbackImage({ imageUrl: c.imageUrl, deepLink: c.deepLink, title: c.title }, deps),
    { concurrency: CONCURRENCY, budgetMs: NO_BUDGET },
  );

  const totals = { alive: 0, resolved: 0, unresolved: 0, catalog: 0, listings: 0, masters: 0 };
  const examples: string[] = [];
  const swaps = new Map<string, string>();
  for (const [i, c] of suspects.entries()) {
    const r = outcomes[i];
    if (!r || r.status === 'unresolved') {
      totals.unresolved += 1;
      continue;
    }
    if (r.status === 'alive' || !r.url) {
      totals.alive += 1;
      continue;
    }
    totals.resolved += 1;
    swaps.set(c.imageUrl, r.url);
    if (examples.length < EXAMPLES) examples.push(`  ${c.imageUrl}\n    → ${r.url}`);
    if (!apply) continue;
    if (c.kind === 'catalog') {
      const res = await prisma.awinCatalogProduct.updateMany({
        where: { id: c.id, imageUrl: c.imageUrl },
        data: { imageUrl: r.url, imageOriginalUrl: c.imageOriginalUrl ?? c.imageUrl },
      });
      totals.catalog += res.count;
    } else {
      const res = await prisma.productListing.updateMany({
        where: { id: c.id, imageUrl: c.imageUrl },
        data: { imageUrl: r.url },
      });
      totals.listings += res.count;
    }
  }

  // 3. Produtos (MasterProduct) que usam alguma das imagens trocadas.
  if (apply && swaps.size > 0) {
    const dead = [...swaps.keys()];
    const masters = await prisma.masterProduct.findMany({
      where: { OR: [{ imageUrl: { in: dead } }, { images: { hasSome: dead } }] },
      select: { id: true, imageUrl: true, images: true },
    });
    for (const m of masters) {
      const swap = (u: string | null) => (u && swaps.get(u)) || u;
      await prisma.masterProduct.update({
        where: { id: m.id },
        data: { imageUrl: swap(m.imageUrl), images: m.images.map((u) => swap(u)!) },
      });
      totals.masters += 1;
    }
  }

  if (examples.length) console.log(`\nExemplos:\n${examples.join('\n')}`);
  if (swaps.size > EXAMPLES) console.log(`  … e mais ${swaps.size - EXAMPLES}`);
  console.log(
    `\nTotal: ${suspects.length} verificadas em ${suspectHosts.size} hosts suspeitos; ` +
      `${totals.alive} no ar, ${totals.resolved} com substituta, ${totals.unresolved} sem substituta.`,
  );
  if (apply) {
    console.log(
      `Gravado: ${totals.catalog} no catálogo, ${totals.listings} ofertas, ${totals.masters} produtos.`,
    );
  } else {
    console.log('Nada foi gravado. Rode com --apply para aplicar.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
