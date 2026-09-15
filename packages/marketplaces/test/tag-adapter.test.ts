import { describe, it, expect } from 'vitest';
import { createTagAdapter, UnsupportedError, getAdapter } from '../src/index';

describe('tag adapters', () => {
  it('amazon converte e valida conexão', async () => {
    const a = createTagAdapter('AMAZON');
    expect(await a.checkConnection({ tag: 'minha-20' })).toEqual({ ok: true });
    expect((await a.checkConnection({})).ok).toBe(false);
    expect(
      await a.toAffiliateLink({ tag: 'minha-20' }, 'https://www.amazon.com.br/dp/B0ABCDEF12'),
    ).toBe('https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20');
  });
  it('mercado livre exige matt_word e matt_tool', async () => {
    const a = createTagAdapter('MERCADOLIVRE');
    expect((await a.checkConnection({ mattWord: 'x' })).ok).toBe(false);
    expect((await a.checkConnection({ mattWord: 'x', mattTool: '1' })).ok).toBe(true);
  });
  it('search/fetchByUrls não suportados', async () => {
    const a = createTagAdapter('MAGALU');
    await expect(
      a.fetchByUrls({ tag: 'loja' }, ['https://www.magazineluiza.com.br/x/p/a1/te/ab/']),
    ).rejects.toBeInstanceOf(UnsupportedError);
    expect(a.search).toBeUndefined();
  });
  it('registry devolve o adapter certo e cacheia', () => {
    expect(getAdapter('AMAZON').kind).toBe('AMAZON');
    expect(getAdapter('AMAZON')).toBe(getAdapter('AMAZON'));
    expect(getAdapter('SHOPEE').kind).toBe('SHOPEE');
  });
});
