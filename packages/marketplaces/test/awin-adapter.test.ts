import { describe, it, expect, vi } from 'vitest';
import { createAwinAdapter } from '../src/awin/adapter';
import { UnsupportedError } from '../src/tag-adapter';

function fetchReturningText(status: number, text: string): typeof fetch {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text })) as unknown as typeof fetch;
}

const creds = { publisherId: 'pub1', datafeedApiKey: 'key1', feedIds: ['222'] };

describe('createAwinAdapter', () => {
  it('checkConnection ok quando o feedId configurado aparece na listagem', async () => {
    const csv = 'Advertiser ID,Advertiser Name,Feed ID,Feed Name,URL\n111,Loja X,222,Feed,https://x\n';
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, csv) });
    expect(await adapter.checkConnection(creds)).toEqual({ ok: true });
  });

  it('checkConnection falha quando o feedId configurado não aparece', async () => {
    const csv = 'Advertiser ID,Advertiser Name,Feed ID,Feed Name,URL\n111,Loja X,999,Feed,https://x\n';
    const adapter = createAwinAdapter({ fetchImpl: fetchReturningText(200, csv) });
    const result = await adapter.checkConnection(creds);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('222');
  });

  it('checkConnection falha sem datafeedApiKey/feedIds', async () => {
    const adapter = createAwinAdapter();
    const result = await adapter.checkConnection({ publisherId: 'p', datafeedApiKey: '', feedIds: [] });
    expect(result.ok).toBe(false);
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
});
