import { describe, expect, it, vi } from 'vitest';
import {
  AwinApiError,
  generateAwinLink,
  generateAwinLinksBatch,
  generateAwinTrackingLinkViaApi,
  getAwinLinkQuota,
  parseAwinCreadLink,
} from '../src';

const creds = { publisherId: '691887', offersApiToken: 'tok' };

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Responde ao lote ecoando cada pedido com um link; `fail` decide quais índices falham. */
function batchFetch(fail: (advertiserId: number) => boolean = () => false) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const { requests } = JSON.parse(String(init?.body)) as {
      requests: { advertiserId: number; destinationUrl: string }[];
    };
    return json(200, {
      responses: requests.map((r) =>
        fail(r.advertiserId)
          ? { status: 400, body: { error: 'deeplinkNotPermitted' }, request: r }
          : {
              status: 200,
              body: { url: `https://www.awin1.com/cread.php?awinmid=${r.advertiserId}&x=1` },
              request: r,
            },
      ),
    });
  });
}

describe('generateAwinLinksBatch', () => {
  it('divide em blocos de 100 e preserva a ordem', async () => {
    const fetchImpl = batchFetch();
    const requests = Array.from({ length: 205 }, (_, i) => ({
      advertiserId: i + 1,
      destinationUrl: `https://loja.com.br/p/${i}`,
    }));
    const out = await generateAwinLinksBatch(creds, requests, { fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const sizes = fetchImpl.mock.calls.map(
      (c) => JSON.parse(String(c[1]?.body)).requests.length as number,
    );
    expect(sizes).toEqual([100, 100, 5]);
    expect(out).toHaveLength(205);
    expect(out[0]).toEqual({ ok: true, url: 'https://www.awin1.com/cread.php?awinmid=1&x=1' });
    expect(out[204]).toEqual({ ok: true, url: 'https://www.awin1.com/cread.php?awinmid=205&x=1' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.awin.com/publishers/691887/linkbuilder/generate-batch');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('envia os clickrefs como parameters', async () => {
    const fetchImpl = batchFetch();
    await generateAwinLinksBatch(
      creds,
      [
        {
          advertiserId: 7,
          destinationUrl: 'https://loja.com.br/p',
          parameters: { clickref: 'sub1', clickref2: 'grp' },
        },
      ],
      { fetchImpl: fetchImpl as never },
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.requests[0]).toEqual({
      advertiserId: 7,
      destinationUrl: 'https://loja.com.br/p',
      parameters: { clickref: 'sub1', clickref2: 'grp' },
    });
  });

  it('falha parcial: item recusado vira erro sem derrubar os demais', async () => {
    const fetchImpl = batchFetch((id) => id === 2);
    const out = await generateAwinLinksBatch(
      creds,
      [1, 2, 3].map((id) => ({ advertiserId: id, destinationUrl: `https://l.com/${id}` })),
      { fetchImpl: fetchImpl as never },
    );
    expect(out[0]!.ok).toBe(true);
    expect(out[1]).toEqual({ ok: false, error: expect.stringContaining('não permite') });
    expect(out[2]!.ok).toBe(true);
  });

  it('erro de rede no bloco marca todos os itens do bloco como falha', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const out = await generateAwinLinksBatch(
      creds,
      [1, 2].map((id) => ({ advertiserId: id, destinationUrl: `https://l.com/${id}` })),
      { fetchImpl: fetchImpl as never },
    );
    expect(out).toEqual([
      { ok: false, error: expect.any(String) },
      { ok: false, error: expect.any(String) },
    ]);
  });

  it('401 propaga AwinApiError AWIN_UNAUTHORIZED', async () => {
    const fetchImpl = vi.fn(async () => json(401, {}));
    await expect(
      generateAwinLinksBatch(creds, [{ advertiserId: 1, destinationUrl: 'https://l.com' }], {
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toMatchObject({ name: 'AwinApiError', code: 'AWIN_UNAUTHORIZED' });
    expect(AwinApiError).toBeDefined();
  });

  it('lista vazia não chama a Awin', async () => {
    const fetchImpl = vi.fn();
    expect(await generateAwinLinksBatch(creds, [], { fetchImpl: fetchImpl as never })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('getAwinLinkQuota', () => {
  it('lê limit e usage e calcula remaining', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      json(200, { publisherId: 691887, limit: 50, usage: 12 }),
    );
    expect(await getAwinLinkQuota(creds, { fetchImpl: fetchImpl as never })).toEqual({
      limit: 50,
      usage: 12,
      remaining: 38,
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.awin.com/publishers/691887/linkbuilder/quota',
    );
  });

  it('sem limite informado → limit e remaining nulos', async () => {
    const fetchImpl = vi.fn(async () => json(200, { usage: 3 }));
    expect(await getAwinLinkQuota(creds, { fetchImpl: fetchImpl as never })).toEqual({
      limit: null,
      usage: 3,
      remaining: null,
    });
  });

  it('401 → AWIN_UNAUTHORIZED; outro erro → AWIN_ERROR', async () => {
    await expect(
      getAwinLinkQuota(creds, { fetchImpl: vi.fn(async () => json(403, {})) as never }),
    ).rejects.toMatchObject({ code: 'AWIN_UNAUTHORIZED' });
    await expect(
      getAwinLinkQuota(creds, { fetchImpl: vi.fn(async () => json(500, {})) as never }),
    ).rejects.toMatchObject({ code: 'AWIN_ERROR' });
  });
});

describe('parseAwinCreadLink', () => {
  it('extrai anunciante, destino e clickrefs de um cread.php', () => {
    const link =
      'https://www.awin1.com/cread.php?awinmid=68224&awinaffid=691887&platform=dl&ued=https%3A%2F%2Fwww.drogal.com.br%2Fp%3Fa%3D1&clickref=sub1&clickref2=GRP1&clickref3=lote9';
    expect(parseAwinCreadLink(link)).toEqual({
      advertiserId: 68224,
      destinationUrl: 'https://www.drogal.com.br/p?a=1',
      parameters: { clickref: 'sub1', clickref2: 'GRP1', clickref3: 'lote9' },
    });
  });

  it('null para pclick.php, outros hosts e links sem destino', () => {
    expect(parseAwinCreadLink('https://www.awin1.com/pclick.php?p=1&a=2&m=3')).toBeNull();
    expect(parseAwinCreadLink('https://www.drogal.com.br/p')).toBeNull();
    expect(parseAwinCreadLink('https://www.awin1.com/cread.php?awinmid=1')).toBeNull();
    expect(parseAwinCreadLink('https://evil.com/cread.php?awinmid=1&ued=https%3A%2F%2Fx.com')).toBeNull();
    expect(parseAwinCreadLink('não é url')).toBeNull();
  });
});

describe('generateAwinLink', () => {
  it('pede o link curto com shorten e devolve shortUrl', async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      json(200, { url: 'https://www.awin1.com/cread.php?x', shortUrl: 'https://tidd.ly/abc' }),
    );
    const out = await generateAwinLink(
      creds,
      { advertiserId: 1, destinationUrl: 'https://l.com', parameters: { clickref2: 'G' } },
      { shorten: true, fetchImpl: fetchImpl as never },
    );
    expect(out).toEqual({ url: 'https://www.awin1.com/cread.php?x', shortUrl: 'https://tidd.ly/abc' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.awin.com/publishers/691887/linkbuilder/generate');
    expect(JSON.parse(String(init?.body))).toEqual({
      advertiserId: 1,
      destinationUrl: 'https://l.com',
      parameters: { clickref2: 'G' },
      shorten: true,
    });
  });

  it('erro HTTP vira AwinApiError', async () => {
    await expect(
      generateAwinLink(creds, { advertiserId: 1, destinationUrl: 'https://l.com' }, {
        fetchImpl: vi.fn(async () => json(429, {})) as never,
      }),
    ).rejects.toMatchObject({ name: 'AwinApiError', code: 'AWIN_ERROR' });
  });
});

describe('nenhuma requisição a links de rastreio', () => {
  it('todas as chamadas vão para api.awin.com (nunca awin1.com)', async () => {
    const hosts: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      hosts.push(new URL(url).hostname);
      if (url.endsWith('/quota')) return json(200, { limit: 10, usage: 1 });
      if (url.endsWith('/generate-batch')) {
        const { requests } = JSON.parse(String(init?.body));
        return json(200, {
          responses: requests.map(() => ({ status: 200, body: { url: 'https://www.awin1.com/cread.php?a=1' } })),
        });
      }
      return json(200, { url: 'https://www.awin1.com/cread.php?a=1', shortUrl: 'https://tidd.ly/a' });
    });
    const f = { fetchImpl: fetchImpl as never };
    const cread =
      'https://www.awin1.com/cread.php?awinmid=1&awinaffid=691887&ued=https%3A%2F%2Fl.com';
    parseAwinCreadLink(cread);
    parseAwinCreadLink('https://www.awin1.com/pclick.php?p=1');
    await getAwinLinkQuota(creds, f);
    await generateAwinLinksBatch(creds, [{ advertiserId: 1, destinationUrl: cread }], f);
    await generateAwinLink(creds, { advertiserId: 1, destinationUrl: 'https://l.com' }, {
      ...f,
      shorten: true,
    });
    await generateAwinTrackingLinkViaApi(creds, { advertiserId: 1, destinationUrl: 'https://l.com' }, f);
    expect(hosts.length).toBe(4);
    expect(new Set(hosts)).toEqual(new Set(['api.awin.com']));
  });
});
