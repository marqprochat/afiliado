import { describe, it, expect } from 'vitest';
import { sanitizeTrackParam, withSiteChannelParams } from '../src/channel-link';

describe('sanitizeTrackParam', () => {
  it('mantém só letras e números, até 32', () => {
    expect(sanitizeTrackParam('wAbc12')).toBe('wAbc12');
    expect(sanitizeTrackParam('a-b_c d')).toBe('abcd');
    expect(sanitizeTrackParam('x'.repeat(40))).toHaveLength(32);
  });
  it('vazio, nulo ou não-string → null', () => {
    expect(sanitizeTrackParam('')).toBeNull();
    expect(sanitizeTrackParam('---')).toBeNull();
    expect(sanitizeTrackParam(undefined)).toBeNull();
    expect(sanitizeTrackParam(['a'] as unknown)).toBeNull();
  });
});

describe('withSiteChannelParams', () => {
  it('acrescenta c e b na URL da página da oferta', () => {
    expect(
      withSiteChannelParams('https://site.test/ofertas/tv-55-ab12', {
        channel: 'wAbc12',
        batch: 'b1',
      }),
    ).toBe('https://site.test/ofertas/tv-55-ab12?c=wAbc12&b=b1');
  });
  it('sobrescreve c/b e preserva outros parâmetros', () => {
    const out = new URL(
      withSiteChannelParams('https://site.test/ofertas/x?utm=1&c=velho', { channel: 'tXyz98' }),
    );
    expect(out.searchParams.get('utm')).toBe('1');
    expect(out.searchParams.get('c')).toBe('tXyz98');
    expect(out.searchParams.has('b')).toBe(false);
  });
  it('sem canal nem lote, ou URL inválida, devolve igual', () => {
    expect(withSiteChannelParams('https://site.test/ofertas/x', {})).toBe(
      'https://site.test/ofertas/x',
    );
    expect(withSiteChannelParams('lixo', { channel: 'a' })).toBe('lixo');
  });
});
