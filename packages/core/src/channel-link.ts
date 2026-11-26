/** Parâmetro de rastreio do site (`c` = canal, `b` = lote): só letras e números, até 32; senão null. */
export function sanitizeTrackParam(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  return s || null;
}

export interface SiteChannelParams {
  channel?: string | null | undefined;
  batch?: string | null | undefined;
}

/**
 * Link da página da oferta no site com o canal e o lote: `<site>/ofertas/<slug>?c=<canal>&b=<lote>`.
 * O botão "comprar" da página repassa esses valores para `/api/v1/r/<listingId>`.
 */
export function withSiteChannelParams(url: string, params: SiteChannelParams): string {
  const c = sanitizeTrackParam(params.channel);
  const b = sanitizeTrackParam(params.batch);
  if (!c && !b) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (c) u.searchParams.set('c', c);
  if (b) u.searchParams.set('b', b);
  return u.toString();
}
