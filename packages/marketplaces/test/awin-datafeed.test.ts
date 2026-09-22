import { describe, it, expect, vi } from 'vitest';
import { listDatafeeds, downloadFeed, AwinApiError } from '../src/awin/datafeed';

function fetchReturningText(status: number, text: string): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  })) as unknown as typeof fetch;
}

describe('listDatafeeds', () => {
  it('parseia o CSV de listagem em AwinFeedListEntry[]', async () => {
    const csv =
      'Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL\n' +
      '111,Loja X,BR,joined,222,Feed Principal,pt,,2026-09-01,https://productdata.awin.com/download/222\n';
    const fetchImpl = fetchReturningText(200, csv);
    const result = await listDatafeeds('key123', { fetchImpl, listBaseUrl: 'https://productdata.awin.com/datafeed/list/apikey' });
    expect(fetchImpl).toHaveBeenCalledWith('https://productdata.awin.com/datafeed/list/apikey/key123');
    expect(result).toEqual([
      {
        advertiserId: '111',
        advertiserName: 'Loja X',
        feedId: '222',
        feedName: 'Feed Principal',
        url: 'https://productdata.awin.com/download/222',
      },
    ]);
  });

  it('lança AWIN_UNAUTHORIZED em 401', async () => {
    const fetchImpl = fetchReturningText(401, '');
    await expect(listDatafeeds('badkey', { fetchImpl })).rejects.toMatchObject({
      code: 'AWIN_UNAUTHORIZED',
    });
  });
});

describe('downloadFeed', () => {
  it('parseia o CSV do catálogo em linhas de objeto', async () => {
    const csv = 'aw_product_id,product_name,search_price\np1,Produto 1,10.50\n';
    const fetchImpl = fetchReturningText(200, csv);
    const rows = await downloadFeed('https://productdata.awin.com/download/222', { fetchImpl });
    expect(rows).toEqual([{ aw_product_id: 'p1', product_name: 'Produto 1', search_price: '10.50' }]);
  });

  it('lança AwinApiError em resposta não-2xx', async () => {
    const fetchImpl = fetchReturningText(500, '');
    await expect(downloadFeed('https://x', { fetchImpl })).rejects.toBeInstanceOf(AwinApiError);
  });
});
