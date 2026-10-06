import { fetchMlListing, MlListingError, type MlListingSource } from '@afilados/marketplaces';
import { ApiError, type MlListingQuery } from '@afilados/shared';

/** Indireção para os testes trocarem a busca real (que acessa o ML) por um dublê. */
export const mlListingDeps = { fetchMlListing };

/** O schema (`searchQuerySchema`) já garante categoryId/url quando o tipo exige. */
export function toMlListingSource(l: MlListingQuery): MlListingSource {
  switch (l.kind) {
    case 'category':
      return { kind: 'category', categoryId: l.categoryId! };
    case 'url':
      return { kind: 'url', url: l.url! };
    case 'lightning':
      return { kind: 'lightning' };
    default:
      return { kind: 'deals' };
  }
}

const GENERIC_LISTING_ERROR =
  'Não foi possível ler a listagem do Mercado Livre agora; tente de novo em instantes';

export function mapMlListingError(e: unknown, hadSession: boolean): ApiError {
  if (e instanceof MlListingError) {
    switch (e.code) {
      case 'ML_LISTING_INVALID_URL':
        return ApiError.validation(e.message);
      case 'ML_LISTING_BLOCKED':
        return new ApiError(
          'MARKETPLACE_ERROR',
          hadSession
            ? 'O Mercado Livre bloqueou a listagem mesmo com a sessão sincronizada; a sessão pode ter expirado. Sincronize de novo pela extensão Afilados Connect'
            : 'O Mercado Livre bloqueou a listagem. Sincronize a sessão pela extensão Afilados Connect e tente de novo',
          502,
        );
      case 'ML_LISTING_LAYOUT':
        return new ApiError(
          'MARKETPLACE_ERROR',
          'A página de ofertas do Mercado Livre mudou de layout e não foi possível ler os produtos',
          502,
        );
      default: // ML_LISTING_HTTP: a mensagem pode ter URL/detalhe interno; o detalhe vai para o log
        return new ApiError('MARKETPLACE_ERROR', GENERIC_LISTING_ERROR, 502);
    }
  }
  return new ApiError('MARKETPLACE_ERROR', GENERIC_LISTING_ERROR, 502);
}
