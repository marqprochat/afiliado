import { describe, it, expect } from 'vitest';
import { buildAffiliateUrl, extractStoreLinks, productKey, rewriteLinks } from '../src/links';

describe('extractStoreLinks', () => {
  it('pega só links oficiais, sem duplicar, na ordem', () => {
    const text = `Oferta! https://shopee.com.br/Prod-i.123.456?sp_atk=x
veja https://www.amazon.com.br/dp/B0ABCDEF12/ref=x e https://meli.la/abc e https://exemplo.com
de novo https://shopee.com.br/Prod-i.123.456?sp_atk=x`;
    const links = extractStoreLinks(text);
    expect(links.map((l) => l.parsed.source)).toEqual(['SHOPEE', 'AMAZON']);
    expect(links[0]!.parsed).toMatchObject({ externalId: '456', shopId: '123' });
  });
  it('ignora pontuação final grudada', () => {
    expect(extractStoreLinks('link: https://www.amazon.com.br/dp/B0ABCDEF12).')[0]!.url).toBe(
      'https://www.amazon.com.br/dp/B0ABCDEF12',
    );
  });
  it('vazio sem links', () => {
    expect(extractStoreLinks('sem nada aqui')).toEqual([]);
    expect(extractStoreLinks('')).toEqual([]);
  });
});

describe('buildAffiliateUrl', () => {
  it('amazon: seta tag, remove ref e utm', () => {
    expect(
      buildAffiliateUrl(
        'AMAZON',
        'https://www.amazon.com.br/Nome/dp/B0ABCDEF12/ref=sr_1?tag=outro-20&utm_source=x',
        { tag: 'minha-20' },
      ),
    ).toBe('https://www.amazon.com.br/Nome/dp/B0ABCDEF12/?tag=minha-20');
  });
  it('mercado livre: matt_word + matt_tool, limpa forceInApp e hash', () => {
    expect(
      buildAffiliateUrl(
        'MERCADOLIVRE',
        'https://produto.mercadolivre.com.br/MLB-123-x-_JM?forceInApp=true#polycard',
        { mattWord: 'minhaid', mattTool: '12345678' },
      ),
    ).toBe(
      'https://produto.mercadolivre.com.br/MLB-123-x-_JM?matt_word=minhaid&matt_tool=12345678',
    );
  });
  it('mercado livre exige os dois', () => {
    expect(() =>
      buildAffiliateUrl('MERCADOLIVRE', 'https://produto.mercadolivre.com.br/MLB-1', {
        mattWord: 'x',
      }),
    ).toThrow(/matt_tool/);
  });
  it('magalu: magazinevoce com a loja', () => {
    expect(
      buildAffiliateUrl(
        'MAGALU',
        'https://www.magazineluiza.com.br/nome/p/abc123/te/ab12/?utm_x=1',
        { tag: 'minhaloja' },
      ),
    ).toBe('https://www.magazinevoce.com.br/minhaloja/nome/p/abc123/te/ab12/');
  });
  it('shopee lança', () => {
    expect(() =>
      buildAffiliateUrl('SHOPEE', 'https://shopee.com.br/x-i.1.2', { tag: 'x' }),
    ).toThrow();
  });
});

describe('rewriteLinks', () => {
  it('substitui todas as ocorrências preservando o texto', () => {
    const map = new Map([['https://a.com/x', 'https://b.com/y']]);
    expect(rewriteLinks('veja https://a.com/x agora https://a.com/x!', map)).toBe(
      'veja https://b.com/y agora https://b.com/y!',
    );
  });
});

describe('productKey', () => {
  it('formata', () =>
    expect(productKey({ source: 'AMAZON', externalId: 'B0X' })).toBe('AMAZON:B0X'));
});
