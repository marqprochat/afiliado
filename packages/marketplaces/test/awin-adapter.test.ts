import { describe, it, expect, vi } from 'vitest';
import { createAwinAdapter } from '../src/awin/adapter';
import { UnsupportedError } from '../src/tag-adapter';

function fetchReturningText(status: number, text: string): typeof fetch {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text })) as unknown as typeof fetch;
}

const feedListUrl = 'https://ui.awin.com/productdata-darwin-download/publisher/1/key/1/feedList';
const creds = { feedListUrl, feedIds: ['222'] };

const activeCsv =
  'Advertiser ID,Advertiser Name,Primary Region,Membership Status,Datafeed Format,Feed ID,Feed Name,URL\n' +
  '111,Loja X,BR,active,Awin,222,Feed,https://x\n';

describe('createAwinAdapter', () => {
  it('checkConnection ok quando há feeds ativos e nenhum feedId selecionado ainda', async () => {
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, activeCsv) });
    expect(await adapter.checkConnection({ feedListUrl, feedIds: [] })).toEqual({ ok: true });
  });

  it('checkConnection ok quando o feedId configurado aparece entre os ativos', async () => {
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, activeCsv) });
    expect(await adapter.checkConnection(creds)).toEqual({ ok: true });
  });

  it('checkConnection falha quando o feedId configurado não aparece entre os ativos', async () => {
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, activeCsv) });
    const result = await adapter.checkConnection({ feedListUrl, feedIds: ['999'] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('999');
  });

  it('checkConnection falha quando não há nenhum feed ativo na conta', async () => {
    const csv =
      'Advertiser ID,Advertiser Name,Primary Region,Membership Status,Datafeed Format,Feed ID,Feed Name,URL\n' +
      '111,Loja X,BR,Not Joined,Awin,222,Feed,https://x\n';
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, csv) });
    const result = await adapter.checkConnection({ feedListUrl, feedIds: [] });
    expect(result).toEqual({ ok: false, error: 'Nenhum programa aprovado na sua conta Awin' });
  });

  it('checkConnection falha sem feedListUrl', async () => {
    const adapter = createAwinAdapter();
    const result = await adapter.checkConnection({ feedListUrl: '', feedIds: [] });
    expect(result).toEqual({ ok: false, error: 'Cole o link da lista de feeds da Awin' });
  });

  it('fetchByUrls sempre retorna vazio (não há lookup ao vivo por URL na Awin)', async () => {
    const adapter = createAwinAdapter();
    expect(await adapter.fetchByUrls(creds, ['https://www.awin1.com/cread.php?x'])).toEqual([]);
  });

  it('toAffiliateLink acrescenta clickref a um deep link da Awin', async () => {
    const adapter = createAwinAdapter();
    const link = await adapter.toAffiliateLink(
      creds,
      'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x',
      'batch-1',
    );
    expect(link).toBe('https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued=x&clickref=batch-1');
  });

  it('toAffiliateLink lança UnsupportedError para URL fora do domínio da Awin', async () => {
    const adapter = createAwinAdapter();
    await expect(adapter.toAffiliateLink(creds, 'https://loja.com/produto', 'sub')).rejects.toBeInstanceOf(
      UnsupportedError,
    );
  });

  it('toAffiliateLink lança UnsupportedError para host que só contém "awin1.com" como texto (ex: query string)', async () => {
    const adapter = createAwinAdapter();
    await expect(
      adapter.toAffiliateLink(creds, 'https://evil.example/?x=awin1.com', 'sub'),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });
});
