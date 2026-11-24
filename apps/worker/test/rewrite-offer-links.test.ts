import { describe, it, expect, vi } from 'vitest';
import type { ProductData } from '@afilados/shared';
import { rewriteOfferLinks, type RewriteOfferLinksCtx } from '../src/lib/rewrite-offer-links';

const product = (url: string): ProductData => ({
  source: 'SHOPEE',
  externalId: '20',
  title: 'Fone',
  price: 10,
  images: [],
  shipping: 'UNKNOWN',
  originalUrl: url,
  raw: {},
});

function ctx(over: Partial<RewriteOfferLinksCtx> = {}): RewriteOfferLinksCtx {
  return {
    tenantId: 't1',
    isEnabled: async () => true,
    resolveShortLinks: async () =>
      new Map([['https://s.shopee.com.br/AFF1', 'https://shopee.com.br/product/10/20']]),
    fetchProduct: vi.fn(async (_t: string, _k: string, url: string) => product(url)),
    publish: vi.fn(async () => 'https://site.test/ofertas/fone-ab12'),
    ...over,
  };
}

describe('rewriteOfferLinks', () => {
  it('troca o link de afiliado da loja pela página do site', async () => {
    const c = ctx();
    const out = await rewriteOfferLinks(
      'Corre! https://s.shopee.com.br/AFF1\nRegras: https://google.com/regras',
      c,
    );
    expect(out).toBe('Corre! https://site.test/ofertas/fone-ab12\nRegras: https://google.com/regras');
    expect(c.fetchProduct).toHaveBeenCalledWith('t1', 'SHOPEE', 'https://shopee.com.br/product/10/20');
    expect(c.publish).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ title: 'Fone' }),
      'https://s.shopee.com.br/AFF1',
    );
  });

  it('mantém o link quando o fetcher falha', async () => {
    const c = ctx({
      fetchProduct: vi.fn(async () => {
        throw new Error('scraping bloqueado');
      }),
    });
    const text = 'Corre! https://s.shopee.com.br/AFF1';
    expect(await rewriteOfferLinks(text, c)).toBe(text);
  });

  it('mantém o link quando a publicação devolve null', async () => {
    const text = 'Corre! https://s.shopee.com.br/AFF1';
    expect(await rewriteOfferLinks(text, ctx({ publish: async () => null }))).toBe(text);
  });

  it('ignora URLs que não são de loja', async () => {
    const c = ctx({ resolveShortLinks: async () => new Map() });
    const text = 'Veja https://google.com/x e https://exemplo.com';
    expect(await rewriteOfferLinks(text, c)).toBe(text);
    expect(c.fetchProduct).not.toHaveBeenCalled();
  });

  it('com a chave desligada não resolve nem busca nada', async () => {
    const resolve = vi.fn(async () => new Map<string, string>());
    const c = ctx({ isEnabled: async () => false, resolveShortLinks: resolve });
    const text = 'Corre! https://s.shopee.com.br/AFF1';
    expect(await rewriteOfferLinks(text, c)).toBe(text);
    expect(resolve).not.toHaveBeenCalled();
    expect(c.fetchProduct).not.toHaveBeenCalled();
  });

  it('processa no máximo 5 URLs de loja por mensagem', async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://www.amazon.com.br/dp/B0ABCDEF1${i}`);
    const c = ctx({ resolveShortLinks: async () => new Map() });
    await rewriteOfferLinks(urls.join('\n'), c);
    expect(c.fetchProduct).toHaveBeenCalledTimes(5);
  });

  it('usa o link original já conhecido sem resolver encurtadores', async () => {
    const resolve = vi.fn(async () => new Map<string, string>());
    const c = ctx({
      resolveShortLinks: resolve,
      knownOriginals: new Map([
        ['https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20', 'https://www.amazon.com.br/dp/B0ABCDEF12'],
      ]),
    });
    await rewriteOfferLinks('Olha https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20', c);
    expect(resolve).not.toHaveBeenCalled();
    expect(c.fetchProduct).toHaveBeenCalledWith('t1', 'AMAZON', 'https://www.amazon.com.br/dp/B0ABCDEF12');
  });
});
