import { describe, it, expect, vi } from 'vitest';
import { createTagAdapter, UnsupportedError, getAdapter } from '../src/index';
import type { AmazonApiItem } from '../src/amazon/creators-api';

describe('tag adapters', () => {
  it('amazon busca produtos via Creators API (GetItems) usando tag como partnerTag', async () => {
    const amazonGetItems = vi.fn(
      async (): Promise<AmazonApiItem[]> => [
        {
          asin: 'B09B8V1LZ3',
          itemInfo: { title: { displayValue: 'Echo Dot' } },
          offersV2: { listings: [{ price: { money: { amount: 299 } } }] },
        },
      ],
    );
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } };

    const result = await a.fetchByUrls(creds, ['https://www.amazon.com.br/dp/B09B8V1LZ3']);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'Echo Dot', price: 299, externalId: 'B09B8V1LZ3' });
    expect(amazonGetItems).toHaveBeenCalledWith(
      ['B09B8V1LZ3'],
      { clientId: 'cid', clientSecret: 'csecret', partnerTag: 'minha-20' },
    );
  });

  it('amazon: URL sem ASIN reconhecível é ignorada (sem crash)', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => []);
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } };
    const result = await a.fetchByUrls(creds, ['https://www.amazon.com.br/busca?q=teste']);
    expect(result).toEqual([]);
    expect(amazonGetItems).not.toHaveBeenCalled();
  });

  it('amazon: sem amazonApi configurado, fetchByUrls devolve lista vazia (sem chamar a API)', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => []);
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const result = await a.fetchByUrls(
      { tag: 'minha-20' },
      ['https://www.amazon.com.br/dp/B09B8V1LZ3'],
    );
    expect(result).toEqual([]);
    expect(amazonGetItems).not.toHaveBeenCalled();
  });

  it('amazon: erro na API não lança — devolve lista vazia (sem fallback)', async () => {
    const amazonGetItems = vi.fn(async (): Promise<AmazonApiItem[]> => {
      throw new Error('boom');
    });
    const a = createTagAdapter('AMAZON', { amazonGetItems });
    const creds = { tag: 'minha-20', amazonApi: { clientId: 'cid', clientSecret: 'csecret' } };
    const result = await a.fetchByUrls(creds, ['https://www.amazon.com.br/dp/B09B8V1LZ3']);
    expect(result).toEqual([]);
  });

  it('amazon: checkConnection só com tag continua ok (comportamento local-only preservado)', async () => {
    const a = createTagAdapter('AMAZON');
    expect(await a.checkConnection({ tag: 'minha-20' })).toEqual({ ok: true });
    expect((await a.checkConnection({})).ok).toBe(false);
  });

  it('amazon: toAffiliateLink por tag continua funcionando (fora de escopo desta fase)', async () => {
    const a = createTagAdapter('AMAZON');
    expect(
      await a.toAffiliateLink({ tag: 'minha-20' }, 'https://www.amazon.com.br/dp/B0ABCDEF12'),
    ).toBe('https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20');
  });

  it('mercado livre exige matt_word e matt_tool', async () => {
    const a = createTagAdapter('MERCADOLIVRE');
    expect((await a.checkConnection({ mattWord: 'x' })).ok).toBe(false);
    expect((await a.checkConnection({ mattWord: 'x', mattTool: '1' })).ok).toBe(true);
  });
  it('search não suportado em tag adapter, fetchByUrls é suportado', async () => {
    const a = createTagAdapter('MAGALU');
    expect(a.search).toBeUndefined();
    expect(typeof a.fetchByUrls).toBe('function');
  });
  it('registry devolve o adapter certo e cacheia', () => {
    expect(getAdapter('AMAZON').kind).toBe('AMAZON');
    expect(getAdapter('AMAZON')).toBe(getAdapter('AMAZON'));
    expect(getAdapter('SHOPEE').kind).toBe('SHOPEE');
  });
});
