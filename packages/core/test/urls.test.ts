import { describe, it, expect } from 'vitest';
import { parseProductUrl } from '../src/urls';

describe('parseProductUrl', () => {
  it('shopee formato -i.shop.item', () => {
    expect(
      parseProductUrl('https://shopee.com.br/Processador-AMD-i.123456.987654?sp_atk=x'),
    ).toEqual({
      source: 'SHOPEE',
      shopId: '123456',
      externalId: '987654',
    });
  });
  it('shopee formato /product/shop/item', () => {
    expect(parseProductUrl('https://shopee.com.br/product/123456/987654')).toEqual({
      source: 'SHOPEE',
      shopId: '123456',
      externalId: '987654',
    });
  });
  it('mercado livre MLB', () => {
    expect(parseProductUrl('https://www.mercadolivre.com.br/produto/p/MLB12345678')).toEqual({
      source: 'MERCADOLIVRE',
      externalId: 'MLB12345678',
    });
    expect(parseProductUrl('https://produto.mercadolivre.com.br/MLB-1234567890-nome-_JM')).toEqual({
      source: 'MERCADOLIVRE',
      externalId: 'MLB1234567890',
    });
  });
  it('amazon ASIN', () => {
    expect(parseProductUrl('https://www.amazon.com.br/Nome/dp/B0ABCDEF12/ref=x')).toEqual({
      source: 'AMAZON',
      externalId: 'B0ABCDEF12',
    });
  });
  it('magalu', () => {
    expect(parseProductUrl('https://www.magazineluiza.com.br/nome/p/abc123def4/te/ab12/')).toEqual({
      source: 'MAGALU',
      externalId: 'abc123def4',
    });
  });
  it('encurtadores e desconhecidos são UNSUPPORTED', () => {
    expect(parseProductUrl('https://s.shopee.com.br/abc').source).toBe('UNSUPPORTED');
    expect(parseProductUrl('https://meli.la/abc').source).toBe('UNSUPPORTED');
    expect(parseProductUrl('nao-e-url').source).toBe('UNSUPPORTED');
    expect(parseProductUrl('https://evilmercadolivre.com.br/MLB123').source).toBe('UNSUPPORTED');
  });
});

describe('parseProductUrl — Awin', () => {
  it('reconhece um deep link awin1.com e não retorna externalId (awinmid é o anunciante, não o produto)', () => {
    const result = parseProductUrl(
      'https://www.awin1.com/cread.php?awinmid=111&awinaffid=456&ued=https%3A%2F%2Floja.com%2Fp1',
    );
    expect(result).toEqual({ source: 'AWIN' });
    expect('externalId' in result).toBe(false);
  });

  it('reconhece um deep link awin1.com mesmo sem awinmid, também sem externalId', () => {
    const result = parseProductUrl('https://www.awin1.com/cread.php?ued=x');
    expect(result).toEqual({ source: 'AWIN' });
    expect('externalId' in result).toBe(false);
  });
});

describe('parseProductUrl — AliExpress', () => {
  it('reconhece URL de item com .html', () => {
    const result = parseProductUrl('https://pt.aliexpress.com/item/1005006240212345.html?spm=a2g0o.productlist');
    expect(result).toEqual({
      source: 'ALIEXPRESS',
      externalId: '1005006240212345',
    });
  });

  it('reconhece URL de item sem .html', () => {
    const result = parseProductUrl('https://www.aliexpress.com/item/32812345678');
    expect(result).toEqual({
      source: 'ALIEXPRESS',
      externalId: '32812345678',
    });
  });

  it('reconhece URL curta / de afiliado do AliExpress sem externalId', () => {
    const result = parseProductUrl('https://s.click.aliexpress.com/e/_d7example');
    expect(result).toEqual({ source: 'ALIEXPRESS' });
    expect('externalId' in result).toBe(false);
  });
});

