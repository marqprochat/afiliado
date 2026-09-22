import { describe, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { listDatafeeds, downloadFeed, AwinApiError } from '../src/awin/datafeed';

function fetchReturningText(status: number, text: string): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  })) as unknown as typeof fetch;
}

function webStreamFromBuffer(buf: Buffer): ReadableStream {
  return Readable.toWeb(Readable.from([buf])) as unknown as ReadableStream;
}

function fetchReturningBody(status: number, body: Buffer): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    body: webStreamFromBuffer(body),
  })) as unknown as typeof fetch;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const row of iter) out.push(row);
  return out;
}

describe('listDatafeeds', () => {
  it('parseia o CSV de listagem (com BOM) em AwinFeedListEntry[]', async () => {
    const csv =
      '﻿Advertiser ID,Advertiser Name,Primary Region,Membership Status,Datafeed Format,Feed ID,Feed Name,Language,Vertical,Last Imported,Last Checked,No of products,URL\n' +
      '111,Loja X,BR,active,Awin,F222,Feed Principal,pt,,2026-09-01,2026-09-02,1500,https://productdata.awin.com/download/222\n';
    const fetchImpl = fetchReturningText(200, csv);
    const result = await listDatafeeds('https://ui.awin.com/feedList/secret', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://ui.awin.com/feedList/secret');
    expect(result).toEqual([
      {
        advertiserId: '111',
        advertiserName: 'Loja X',
        region: 'BR',
        membershipStatus: 'active',
        feedId: 'F222',
        feedName: 'Feed Principal',
        format: 'Awin',
        productCount: 1500,
        url: 'https://productdata.awin.com/download/222',
      },
    ]);
  });

  it('trata formato ausente como Awin e contagem ausente como null (lista antiga)', async () => {
    const csv =
      'Advertiser ID,Advertiser Name,Primary Region,Membership Status,Feed ID,Feed Name,Language,Vertical,Last Imported,URL\n' +
      '111,Loja X,BR,active,222,Feed Principal,pt,,2026-09-01,https://productdata.awin.com/download/222\n';
    const fetchImpl = fetchReturningText(200, csv);
    const result = await listDatafeeds('https://x', { fetchImpl });
    expect(result[0]!.format).toBe('Awin');
    expect(result[0]!.productCount).toBeNull();
  });

  it('lança AWIN_UNAUTHORIZED em 401, sem incluir a URL na mensagem', async () => {
    const fetchImpl = fetchReturningText(401, '');
    await expect(listDatafeeds('https://ui.awin.com/secret-key/feedList', { fetchImpl })).rejects.toMatchObject({
      code: 'AWIN_UNAUTHORIZED',
    });
    try {
      await listDatafeeds('https://ui.awin.com/secret-key/feedList', { fetchImpl });
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-key');
    }
  });

  it('lança AWIN_ERROR em outro status não-2xx', async () => {
    const fetchImpl = fetchReturningText(500, '');
    await expect(listDatafeeds('https://x', { fetchImpl })).rejects.toMatchObject({ code: 'AWIN_ERROR' });
  });
});

describe('downloadFeed — falhas no meio do stream', () => {
  it('rejeita (não trava) quando o gzip vem corrompido', async () => {
    const valid = gzipSync(Buffer.from('id,title\n1,a\n'.repeat(2000)));
    const corrupted = Buffer.concat([valid.subarray(0, 40), Buffer.alloc(200, 0xff)]);
    const iter = await downloadFeed('https://x/f.csv.gz', {
      fetchImpl: fetchReturningBody(200, corrupted),
    });
    await expect(collect(iter)).rejects.toThrow();
  }, 5000);
});

describe('downloadFeed', () => {
  it('transmite (streaming) um CSV simples em linhas de objeto', async () => {
    const csv = 'aw_product_id,product_name,search_price\np1,Produto 1,10.50\n';
    const fetchImpl = fetchReturningBody(200, Buffer.from(csv));
    const iter = await downloadFeed('https://productdata.awin.com/download/222.csv', { fetchImpl });
    const rows = await collect(iter);
    expect(rows).toEqual([{ aw_product_id: 'p1', product_name: 'Produto 1', search_price: '10.50' }]);
  });

  it('detecta e descomprime um arquivo gzip pelos bytes mágicos, não pela URL', async () => {
    const csv = 'aw_product_id,product_name,search_price\np1,Produto Gz,20.00\n';
    const gzipped = gzipSync(Buffer.from(csv));
    const fetchImpl = fetchReturningBody(200, gzipped);
    const iter = await downloadFeed('https://productdata.awin.com/compression/gzip/222', { fetchImpl });
    const rows = await collect(iter);
    expect(rows).toEqual([{ aw_product_id: 'p1', product_name: 'Produto Gz', search_price: '20.00' }]);
  });

  it('lança AwinApiError em resposta não-2xx, sem incluir a URL na mensagem', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(downloadFeed('https://secret-url/x', { fetchImpl })).rejects.toBeInstanceOf(AwinApiError);
    try {
      await downloadFeed('https://secret-url/x', { fetchImpl });
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-url');
    }
  });
});
