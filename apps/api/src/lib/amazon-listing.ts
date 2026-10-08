import { decryptJson, type TenantClient } from '@afilados/db';
import {
  AmazonListingError,
  fetchAmazonListing,
  type AmazonListingSource,
} from '@afilados/marketplaces';
import { ApiError, type AmazonListingQuery, type TagCredentials } from '@afilados/shared';

/** Indireção para os testes trocarem a busca real (que acessa a Amazon) por um dublê. */
export const amazonListingDeps = { fetchAmazonListing };

/** O schema (`searchQuerySchema`) já garante a palavra-chave quando a fonte é `deals`. */
export function toAmazonListingSource(
  l: AmazonListingQuery,
  query: string | undefined,
): AmazonListingSource {
  return l.kind === 'mega' ? { kind: 'mega' } : { kind: 'deals', query: query ?? '' };
}

/**
 * Cookies da sessão sincronizada da Amazon (extensão ou colagem manual), ou undefined. Servem só de
 * segunda tentativa quando a listagem anônima vem bloqueada. Lê a conexão direto, sem exigir a tag
 * de afiliado (`loadTagCredentials` lança sem ela): buscar ofertas não depende da tag.
 */
export async function loadAmazonSessionCookies(
  db: TenantClient,
): Promise<Record<string, string> | undefined> {
  const row = await db.marketplaceConnection.findFirst({ where: { kind: 'AMAZON' } });
  if (!row?.encryptedCredentials) return undefined;
  const creds = decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials));
  const cookies = creds.amazonSession?.cookies;
  return cookies && Object.keys(cookies).length > 0 ? cookies : undefined;
}

const GENERIC_LISTING_ERROR =
  'Não foi possível ler as ofertas da Amazon agora; tente de novo em instantes';

export function mapAmazonListingError(e: unknown, hadSession: boolean): ApiError {
  if (e instanceof AmazonListingError) {
    switch (e.code) {
      case 'AMAZON_LISTING_INVALID_QUERY':
        return ApiError.validation(e.message);
      case 'AMAZON_LISTING_BLOCKED':
        return new ApiError(
          'MARKETPLACE_ERROR',
          hadSession
            ? 'A Amazon bloqueou a listagem mesmo com a sessão sincronizada; a sessão pode ter expirado. Sincronize de novo pela extensão Afilados Connect'
            : 'A Amazon bloqueou a listagem. Sincronize a sessão pela extensão Afilados Connect e tente de novo',
          502,
        );
      case 'AMAZON_LISTING_LAYOUT':
        return new ApiError(
          'MARKETPLACE_ERROR',
          'A página de ofertas da Amazon mudou de layout e não foi possível ler os produtos',
          502,
        );
      default: // AMAZON_LISTING_HTTP: a mensagem pode ter URL/detalhe interno; o detalhe vai para o log
        return new ApiError('MARKETPLACE_ERROR', GENERIC_LISTING_ERROR, 502);
    }
  }
  return new ApiError('MARKETPLACE_ERROR', GENERIC_LISTING_ERROR, 502);
}
