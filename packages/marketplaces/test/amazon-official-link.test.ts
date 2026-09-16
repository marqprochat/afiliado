import { describe, expect, it, vi } from 'vitest';
import {
  AmazonSessionError,
  findFirstUrl,
  generateOfficialAmazonLink,
} from '../src/amazon/official-link';
import { createTagAdapter } from '../src/tag-adapter';

function jsonResponse(body: unknown, init: { status?: number; url?: string } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? 'https://www.amazon.com.br/associates/sitestripe/getShortUrl',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('Gerador oficial de links da Amazon (SiteStripe)', () => {
  const cookies = { 'session-id': 'abc', 'ubid-acbbr': 'xyz' };

  it('usa a sessão para obter o link curto enviando cookies, marketplaceId e storeId', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ shortUrl: 'https://link.amazon/B07AMQVrO' }));
    const link = await generateOfficialAmazonLink(
      'https://www.amazon.com.br/dp/B09B8VGCR8?tag=minha-20',
      cookies,
      'minha-20',
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(link).toBe('https://link.amazon/B07AMQVrO');
    const [calledUrl, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(calledUrl);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://www.amazon.com.br/associates/sitestripe/getShortUrl',
    );
    expect(parsed.searchParams.get('longUrl')).toBe(
      'https://www.amazon.com.br/dp/B09B8VGCR8?tag=minha-20',
    );
    expect(parsed.searchParams.get('marketplaceId')).toBe('526970');
    expect(parsed.searchParams.get('storeId')).toBe('minha-20');
    const headers = init.headers as Record<string, string>;
    expect(headers.Cookie).toBe('session-id=abc; ubid-acbbr=xyz');
  });

  it('lança AmazonSessionError sem cookies', async () => {
    await expect(
      generateOfficialAmazonLink('https://www.amazon.com.br/dp/X', {}, 'tag-20'),
    ).rejects.toMatchObject({ code: 'AMAZON_SESSION_EXPIRED' } satisfies Partial<AmazonSessionError>);
  });

  it('detecta sessão expirada quando a resposta redireciona para o login', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse('', { url: 'https://www.amazon.com.br/ap/signin?x' }));
    await expect(
      generateOfficialAmazonLink('https://www.amazon.com.br/dp/X', cookies, 'tag-20', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'AMAZON_SESSION_EXPIRED' } satisfies Partial<AmazonSessionError>);
  });

  it('lança AMAZON_SITESTRIPE_ERROR quando a resposta não contém uma URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: false }));
    await expect(
      generateOfficialAmazonLink('https://www.amazon.com.br/dp/X', cookies, 'tag-20', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      code: 'AMAZON_SITESTRIPE_ERROR',
    } satisfies Partial<AmazonSessionError>);
  });

  it('helper: encontra a primeira URL em texto arbitrário', () => {
    expect(findFirstUrl('{"shortUrl":"https://link.amazon/abc123"}')).toBe(
      'https://link.amazon/abc123',
    );
    expect(findFirstUrl('nada aqui')).toBeUndefined();
  });

  it('adapter Amazon prefere o link oficial e cai para tag se falhar', async () => {
    const okGen = vi.fn().mockResolvedValue('https://link.amazon/ok');
    const a = createTagAdapter('AMAZON', { amazonOfficialLink: okGen });
    const creds = {
      tag: 'minha-20',
      amazonSession: { cookies, syncedAt: '2026-09-16T00:00:00Z', source: 'manual' as const },
    };
    const url = 'https://www.amazon.com.br/dp/B09B8VGCR8';
    expect(await a.toAffiliateLink(creds, url)).toBe('https://link.amazon/ok');
    // segunda chamada vem do cache
    expect(await a.toAffiliateLink(creds, url)).toBe('https://link.amazon/ok');
    expect(okGen).toHaveBeenCalledTimes(1);

    const failing = createTagAdapter('AMAZON', {
      amazonOfficialLink: vi
        .fn()
        .mockRejectedValue(new AmazonSessionError('x', 'AMAZON_SESSION_EXPIRED')),
    });
    const fallback = await failing.toAffiliateLink(
      creds,
      'https://www.amazon.com.br/dp/OUTRO123',
    );
    expect(fallback).toContain('tag=minha-20');

    // sem tag e com sessão inválida, o erro sobe
    await expect(
      failing.toAffiliateLink(
        { amazonSession: creds.amazonSession },
        'https://www.amazon.com.br/dp/OUTRO456',
      ),
    ).rejects.toBeInstanceOf(AmazonSessionError);
  });

  it('checkConnection valida de verdade quando há sessão, e cai para local-only sem sessão', async () => {
    const ok = createTagAdapter('AMAZON', {
      amazonOfficialLink: vi.fn().mockResolvedValue('https://link.amazon/ok'),
    });
    expect(
      (
        await ok.checkConnection({
          tag: 'minha-20',
          amazonSession: { cookies, syncedAt: '2026-09-16T00:00:00Z', source: 'manual' },
        })
      ).ok,
    ).toBe(true);

    const failing = createTagAdapter('AMAZON', {
      amazonOfficialLink: vi
        .fn()
        .mockRejectedValue(new AmazonSessionError('sessão expirou', 'AMAZON_SESSION_EXPIRED')),
    });
    const result = await failing.checkConnection({
      amazonSession: { cookies, syncedAt: '2026-09-16T00:00:00Z', source: 'manual' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sessão expirou');

    // sem sessão, comportamento local-only preservado
    expect((await ok.checkConnection({ tag: 'minha-20' })).ok).toBe(true);
    expect((await ok.checkConnection({})).ok).toBe(false);
  });
});
