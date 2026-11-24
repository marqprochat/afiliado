import pino from 'pino';
import { prisma, forTenant, type TenantClient } from '@afilados/db';
import { indexProductInPriceEngine, resolveOwnerTenantId } from '@afilados/deals';
import { SITE_LINKS_KEY, siteLinksEnabled, type ProductData } from '@afilados/shared';
import { config } from '../config';

const log = pino({ name: 'publish-offer' });

/** Teto de tempo da indexação por produto; acima disso a mensagem sai com o link de afiliado. */
export const PUBLISH_TIMEOUT_MS = 5_000;

let warnedMissingSiteUrl = false;

export interface PublishOfferOptions {
  /** Origem pública do site; omitido = `config.PUBLIC_SITE_URL`. */
  siteUrl?: string | undefined;
  timeoutMs?: number;
  index?: typeof indexProductInPriceEngine;
  /** Injetável em testes; omitido = `isOwnerTenant`. */
  isOwnerTenant?: (tenantId: string) => Promise<boolean>;
}

export type PublishOfferFn = (
  tenantId: string,
  product: ProductData,
  affiliateUrl: string,
) => Promise<string | null>;

/**
 * O site público é do dono da aplicação: o superadmin mais antigo entre as contas raiz (mesma
 * regra da API, `resolveOwnerTenantId`). Só ele publica ofertas no site; em qualquer outra conta
 * a página nem abriria (o link daria 404).
 */
export async function isOwnerTenant(tenantId: string): Promise<boolean> {
  return tenantId === (await resolveOwnerTenantId());
}

/** Chave `siteLinks` ligada E a conta é a do dono; uma chave perdida em outra conta é ignorada. */
export async function isSiteLinksEnabled(
  db: TenantClient,
  tenantId: string,
  isOwner: (tenantId: string) => Promise<boolean> = isOwnerTenant,
): Promise<boolean> {
  const row = await db.setting.findFirst({ where: { key: SITE_LINKS_KEY } });
  if (!siteLinksEnabled(row?.value)) return false;
  return isOwner(tenantId);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`indexação passou de ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isUniqueConflict(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Publica a oferta na página /ofertas/<slug> do site e devolve a URL dela. Devolve `null` (e o
 * chamador usa o link de afiliado) quando a chave `siteLinks` do tenant está desligada ou o
 * tenant não é o do dono (superadmin raiz mais antigo), quando
 * falta `PUBLIC_SITE_URL`, em qualquer erro ou quando a indexação passa do teto de tempo.
 */
export async function publishOffer(
  db: TenantClient,
  tenantId: string,
  product: ProductData,
  affiliateUrl: string,
  opts: PublishOfferOptions = {},
): Promise<string | null> {
  try {
    if (!(await isSiteLinksEnabled(db, tenantId, opts.isOwnerTenant))) return null;
    const siteUrl = 'siteUrl' in opts ? opts.siteUrl : config.PUBLIC_SITE_URL;
    if (!siteUrl) {
      if (!warnedMissingSiteUrl) {
        warnedMissingSiteUrl = true;
        log.warn({ tenantId }, 'PUBLIC_SITE_URL não definido; ofertas seguem com o link de afiliado');
      }
      return null;
    }
    const index = opts.index ?? indexProductInPriceEngine;
    const run = async () => {
      try {
        return await index(db, tenantId, product, { affiliateUrl });
      } catch (err) {
        // A importação indexa o mesmo produto em paralelo (fire-and-forget): na segunda tentativa
        // a listagem já existe e o motor só a atualiza.
        if (!isUniqueConflict(err)) throw err;
        return index(db, tenantId, product, { affiliateUrl });
      }
    };
    const indexing = run();
    // Depois do timeout a indexação segue em segundo plano; a rejeição tardia não pode vazar.
    indexing.catch(() => undefined);
    const { slug } = await withTimeout(indexing, opts.timeoutMs ?? PUBLISH_TIMEOUT_MS);
    return `${siteUrl.replace(/\/+$/, '')}/ofertas/${slug}`;
  } catch (err) {
    log.warn(
      {
        tenantId,
        source: product.source,
        url: product.originalUrl,
        err: err instanceof Error ? err.message : String(err),
      },
      'publish-offer fallback',
    );
    return null;
  }
}

/** `publishOffer` com o client escopado do tenant e a configuração do processo. */
export const publishOfferForTenant: PublishOfferFn = (tenantId, product, affiliateUrl) =>
  publishOffer(forTenant(tenantId), tenantId, product, affiliateUrl);
