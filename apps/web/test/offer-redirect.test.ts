import { describe, it, expect } from 'vitest';
import { offerRedirectHref, trackQueryFromSearch } from '@/lib/offer-redirect';

describe('trackQueryFromSearch', () => {
  it('repassa só c e b sanitizados', () => {
    expect(trackQueryFromSearch('?c=wAbc12&b=lote1&utm=x')).toBe('?c=wAbc12&b=lote1');
    expect(trackQueryFromSearch('?b=lote-1')).toBe('?b=lote1');
    expect(trackQueryFromSearch('?c=---')).toBe('');
    expect(trackQueryFromSearch('')).toBe('');
  });
});

describe('offerRedirectHref', () => {
  it('aponta para o redirecionamento da API com c/b', () => {
    expect(offerRedirectHref('l1', '?c=wAbc12')).toBe('/api/v1/r/l1?c=wAbc12');
    expect(offerRedirectHref('l 2', '')).toBe('/api/v1/r/l%202');
  });
});
