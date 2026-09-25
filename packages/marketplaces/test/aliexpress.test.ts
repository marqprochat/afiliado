import { describe, it, expect, vi } from 'vitest';
import {
  signAliexpressRequest,
  AliexpressClient,
  AliexpressApiError,
  mapAliexpressProduct,
  createAliexpressAdapter,
} from '../src/aliexpress';

describe('signAliexpressRequest', () => {
  it('gera a assinatura HMAC-SHA256 com chaves ordenadas em maiúsculo', () => {
    const params = {
      app_key: '12345',
      timestamp: 1600000000000,
      method: 'aliexpress.affiliate.link.generate',
      format: 'json',
      v: '2.0',
      tracking_id: 'track123',
    };
    const sign = signAliexpressRequest(params, 'secret_key');
    expect(typeof sign).toBe('string');
    expect(sign).toBe(sign.toUpperCase());
    expect(sign.length).toBe(64); // SHA-256 em hex tem 64 chars
  });

  it('ignora parâmetros nulos, indefinidos ou o próprio sign', () => {
    const params1 = {
      app_key: '12345',
      method: 'test.method',
    };
    const params2 = {
      app_key: '12345',
      method: 'test.method',
      sign: 'OLD_SIGN',
      empty: '',
      nullVal: null,
      undefVal: undefined,
    };
    expect(signAliexpressRequest(params1, 'secret')).toBe(signAliexpressRequest(params2, 'secret'));
  });
});

describe('AliexpressClient', () => {
  const creds = {
    appKey: 'test_app_key',
    appSecret: 'test_secret',
    trackingId: 'test_tracking_id',
  };

  it('faz requisição POST com query string assinada e retorna o resultado', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aliexpress_affiliate_link_generate_response: {
          resp_result: {
            resp_code: 200,
            result: {
              promotion_links: {
                promotion_link: [{ promotion_link: 'https://s.click.aliexpress.com/e/_test' }],
              },
            },
          },
        },
      }),
    });

    const client = new AliexpressClient(creds, { fetchImpl: mockFetch as any });
    const res = await client.execute<any>('aliexpress.affiliate.link.generate', {
      source_values: 'https://pt.aliexpress.com/item/100500123.html',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0]![0];
    expect(calledUrl).toContain('app_key=test_app_key');
    expect(calledUrl).toContain('sign=');
    expect(calledUrl).toContain('method=aliexpress.affiliate.link.generate');

    expect(
      res.aliexpress_affiliate_link_generate_response.resp_result.result.promotion_links.promotion_link[0].promotion_link,
    ).toBe('https://s.click.aliexpress.com/e/_test');
  });

  it('lança AliexpressApiError quando a API retorna error_response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error_response: {
          code: 15,
          msg: 'Remote service error',
          sub_code: 'isv.invalid-parameter',
          sub_msg: 'Invalid tracking_id',
        },
      }),
    });

    const client = new AliexpressClient(creds, { fetchImpl: mockFetch as any });
    await expect(
      client.execute('aliexpress.affiliate.link.generate', { tracking_id: 'invalid' }),
    ).rejects.toThrow(AliexpressApiError);
  });
});

describe('mapAliexpressProduct', () => {
  it('mapeia produto do AliExpress para ProductData com preços em BRL e desconto', () => {
    const raw = {
      product_id: 1005006240212345,
      product_title: 'Fone de Ouvido Bluetooth Sem Fio',
      target_sale_price: '49.90',
      target_original_price: '99.90',
      discount: '50%',
      product_main_image_url: 'https://ae-pic-a1.aliexpress-media.com/main.jpg',
      product_small_image_urls: {
        string: [
          'https://ae-pic-a1.aliexpress-media.com/1.jpg',
          'https://ae-pic-a1.aliexpress-media.com/2.jpg',
        ],
      },
      promotion_link: 'https://s.click.aliexpress.com/e/_test',
      lastest_volume: 1250,
      commission_rate: '7.5%',
    };

    const mapped = mapAliexpressProduct(raw);
    expect(mapped.source).toBe('ALIEXPRESS');
    expect(mapped.externalId).toBe('1005006240212345');
    expect(mapped.title).toBe('Fone de Ouvido Bluetooth Sem Fio');
    expect(mapped.price).toBe(49.9);
    expect(mapped.originalPrice).toBe(99.9);
    expect(mapped.discountPct).toBe(50);
    expect(mapped.images).toEqual([
      'https://ae-pic-a1.aliexpress-media.com/main.jpg',
      'https://ae-pic-a1.aliexpress-media.com/1.jpg',
      'https://ae-pic-a1.aliexpress-media.com/2.jpg',
    ]);
    expect(mapped.originalUrl).toBe('https://s.click.aliexpress.com/e/_test');
    expect(mapped.salesCount).toBe(1250);
    expect(mapped.commissionPct).toBe(7.5);
  });
});

describe('createAliexpressAdapter', () => {
  const creds = {
    appKey: 'app_key_123',
    appSecret: 'app_secret_abc',
    trackingId: 'track_xyz',
  };

  it('checkConnection retorna ok: true quando a API responde com sucesso', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aliexpress_affiliate_link_generate_response: {
          resp_result: { resp_code: 200, result: { promotion_links: [] } },
        },
      }),
    });

    const adapter = createAliexpressAdapter({ fetchImpl: mockFetch as any });
    const status = await adapter.checkConnection(creds);
    expect(status.ok).toBe(true);
  });

  it('checkConnection retorna ok: false se faltar credencial', async () => {
    const adapter = createAliexpressAdapter();
    const status = await adapter.checkConnection({ appKey: '', appSecret: '', trackingId: '' });
    expect(status.ok).toBe(false);
    expect(status.error).toContain('Credenciais incompletas');
  });

  it('search busca produtos via aliexpress.affiliate.product.query', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aliexpress_affiliate_product_query_response: {
          resp_result: {
            resp_code: 200,
            result: {
              products: {
                product: [
                  {
                    product_id: 111,
                    product_title: 'Smartwatch',
                    target_sale_price: '120.00',
                  },
                ],
              },
            },
          },
        },
      }),
    });

    const adapter = createAliexpressAdapter({ fetchImpl: mockFetch as any });
    const items = await adapter.search!(creds, {
      source: 'ALIEXPRESS',
      mode: 'keyword',
      query: 'smartwatch',
      sort: 'DISCOUNT_DESC',
      topSellers: false,
      extraCommission: false,
      limit: 10,
      freeShippingOnly: false,
    });

    expect(items.length).toBe(1);
    expect(items[0]!.title).toBe('Smartwatch');
    expect(items[0]!.price).toBe(120);
    expect(items[0]!.source).toBe('ALIEXPRESS');
  });

  it('fetchByUrls extrai IDs da URL e busca detalhes via aliexpress.affiliate.productdetail.get', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aliexpress_affiliate_productdetail_get_response: {
          resp_result: {
            resp_code: 200,
            result: {
              products: {
                product: [
                  {
                    product_id: 100500123456,
                    product_title: 'Teclado Mecânico',
                    target_sale_price: '250.00',
                  },
                ],
              },
            },
          },
        },
      }),
    });

    const adapter = createAliexpressAdapter({ fetchImpl: mockFetch as any });
    const items = await adapter.fetchByUrls(creds, [
      'https://pt.aliexpress.com/item/100500123456.html?spm=123',
    ]);

    expect(items.length).toBe(1);
    expect(items[0]!.externalId).toBe('100500123456');
    expect(items[0]!.title).toBe('Teclado Mecânico');
  });

  it('toAffiliateLink gera link com subId via aliexpress.affiliate.link.generate', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aliexpress_affiliate_link_generate_response: {
          resp_result: {
            resp_code: 200,
            result: {
              promotion_links: {
                promotion_link: [
                  {
                    promotion_link: 'https://s.click.aliexpress.com/e/_d7subid',
                  },
                ],
              },
            },
          },
        },
      }),
    });

    const adapter = createAliexpressAdapter({ fetchImpl: mockFetch as any });
    const link = await adapter.toAffiliateLink(
      creds,
      'https://pt.aliexpress.com/item/100500123456.html',
      'batch-123',
    );

    expect(link).toBe('https://s.click.aliexpress.com/e/_d7subid');
    const calledUrl = mockFetch.mock.calls[0]![0];
    expect(calledUrl).toContain('sub_id=batch-123');
    expect(calledUrl).toContain('tracking_id=track_xyz');
  });

  it('suporta formato simplificado (simplify=true) na busca', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resp_result: {
          resp_code: 200,
          result: {
            products: {
              product: [
                {
                  product_id: 999,
                  product_title: 'Fone TWS',
                  target_sale_price: '55.00',
                  shop_id: 12345,
                  shop_name: 'Minha Loja',
                },
              ],
            },
          },
        },
      }),
    });

    const adapter = createAliexpressAdapter({ fetchImpl: mockFetch as any });
    const items = await adapter.search!(creds, {
      source: 'ALIEXPRESS',
      mode: 'keyword',
      query: 'fone',
      sort: 'DISCOUNT_DESC',
      topSellers: false,
      extraCommission: false,
      limit: 10,
      freeShippingOnly: false,
    });

    expect(items.length).toBe(1);
    expect(items[0]!.title).toBe('Fone TWS');
    expect(items[0]!.shopId).toBe('12345');
    expect(items[0]!.shopName).toBe('Minha Loja');
  });

  it('busca trending usa aliexpress.affiliate.hotproduct.query', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resp_result: {
          resp_code: 200,
          result: {
            products: [
              {
                product_id: 888,
                product_title: 'Hot Product',
                target_sale_price: '20.00',
              },
            ],
          },
        },
      }),
    });

    const adapter = createAliexpressAdapter({ fetchImpl: mockFetch as any });
    const items = await adapter.search!(creds, {
      source: 'ALIEXPRESS',
      mode: 'trending',
      sort: 'DISCOUNT_DESC',
      topSellers: false,
      extraCommission: false,
      limit: 10,
      freeShippingOnly: false,
    });

    expect(items.length).toBe(1);
    expect(items[0]!.title).toBe('Hot Product');
    const calledUrl = mockFetch.mock.calls[0]![0];
    expect(calledUrl).toContain('method=aliexpress.affiliate.hotproduct.query');
  });
  it('não envia sorts que a API do AliExpress não aceita (discount_desc) — cai no padrão last_volume_desc', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aliexpress_affiliate_product_query_response: {
          resp_result: { resp_code: 200, result: { products: { product: [] } } },
        },
      }),
    });

    const adapter = createAliexpressAdapter({ fetchImpl: mockFetch as any });
    await adapter.search!(creds, {
      source: 'ALIEXPRESS',
      mode: 'keyword',
      query: 'notebook',
      sort: 'DISCOUNT_DESC',
      limit: 10,
      topSellers: false,
      extraCommission: false,
      freeShippingOnly: false,
    });

    const calledUrl = String(mockFetch.mock.calls[0]![0]);
    expect(calledUrl).toContain('sort=last_volume_desc');
    expect(calledUrl).not.toContain('discount_desc');

    mockFetch.mockClear();
    await adapter.search!(creds, {
      source: 'ALIEXPRESS',
      mode: 'keyword',
      query: 'notebook',
      sort: 'COMMISSION_DESC',
      limit: 10,
      topSellers: false,
      extraCommission: false,
      freeShippingOnly: false,
    });
    expect(String(mockFetch.mock.calls[0]![0])).toContain('sort=last_volume_desc');
  });
});
