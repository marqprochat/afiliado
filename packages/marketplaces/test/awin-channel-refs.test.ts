import { describe, it, expect } from 'vitest';
import { withAwinChannelRefs } from '../src/awin/channel-refs';

const AWIN =
  'https://www.awin1.com/cread.php?awinmid=9999&awinaffid=12345&platform=dl&ued=https%3A%2F%2Floja.com%2Fp%3Fx%3D1&clickref=afiliado1';

describe('withAwinChannelRefs', () => {
  it('adiciona clickref2 (canal) e clickref3 (lote) preservando clickref e ued', () => {
    const out = new URL(withAwinChannelRefs(AWIN, { channel: 'wAbc12', batch: 'cmbatch1' }));
    expect(out.searchParams.get('clickref')).toBe('afiliado1');
    expect(out.searchParams.get('clickref2')).toBe('wAbc12');
    expect(out.searchParams.get('clickref3')).toBe('cmbatch1');
    expect(out.searchParams.get('ued')).toBe('https://loja.com/p?x=1');
    expect(out.searchParams.get('awinmid')).toBe('9999');
  });

  it('sobrescreve clickref2/3 já existentes', () => {
    const url = `${AWIN}&clickref2=velho&clickref3=velho`;
    const out = new URL(withAwinChannelRefs(url, { channel: 'tXyz98', batch: 'novo' }));
    expect(out.searchParams.getAll('clickref2')).toEqual(['tXyz98']);
    expect(out.searchParams.getAll('clickref3')).toEqual(['novo']);
  });

  it('sanitiza e ignora valores vazios', () => {
    const out = new URL(withAwinChannelRefs(AWIN, { channel: 'w-A b!c', batch: '' }));
    expect(out.searchParams.get('clickref2')).toBe('wAbc');
    expect(out.searchParams.has('clickref3')).toBe(false);
  });

  it('sem refs devolve a mesma URL', () => {
    expect(withAwinChannelRefs(AWIN, {})).toBe(AWIN);
  });

  it('não mexe em URLs que não são cread.php da Awin', () => {
    const others = [
      'https://shopee.com.br/product/1/1',
      'https://www.awin1.com/pclick.php?p=1',
      'https://awin1.com.evil.test/cread.php?x=1',
      'não é url',
    ];
    for (const u of others)
      expect(withAwinChannelRefs(u, { channel: 'wAbc12', batch: 'b' })).toBe(u);
  });

  it('aceita awin1.com sem www', () => {
    const out = withAwinChannelRefs('https://awin1.com/cread.php?awinmid=1&awinaffid=2', {
      channel: 'wAbc12',
    });
    expect(new URL(out).searchParams.get('clickref2')).toBe('wAbc12');
  });
});
