'use client';
import { useEffect, useState } from 'react';

const clean = (v: string | null) => (v ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);

/** `?c=<canal>&b=<lote>` da URL da página (sanitizados); vazio quando não há nenhum dos dois. */
export function trackQueryFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const out = new URLSearchParams();
  const c = clean(params.get('c'));
  const b = clean(params.get('b'));
  if (c) out.set('c', c);
  if (b) out.set('b', b);
  const qs = out.toString();
  return qs ? `?${qs}` : '';
}

/** Botão "comprar": passa pelo redirecionamento da API (conta o clique e põe o canal no link). */
export function offerRedirectHref(listingId: string, trackQuery: string): string {
  return `/api/v1/r/${encodeURIComponent(listingId)}${trackQuery}`;
}

/** `c`/`b` da página atual, lidos depois de montar (evita divergência na hidratação). */
export function useTrackQuery(): string {
  const [qs, setQs] = useState('');
  useEffect(() => {
    setQs(trackQueryFromSearch(window.location.search));
  }, []);
  return qs;
}
