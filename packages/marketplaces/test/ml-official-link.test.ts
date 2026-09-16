import { describe, expect, it, vi } from 'vitest';
import * as cheerio from 'cheerio';
import {
  createTagAdapter,
  detectFlashSaleEnd,
  extractCsrfToken,
  findMeliLink,
  generateOfficialMlLink,
  MlSessionError,
  parseMercadoLivreHtml,
} from '../src';

function jsonResponse(body: unknown, init: { status?: number; url?: string } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? 'https://www.mercadolivre.com.br/x',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('Gerador oficial de links do Mercado Livre (F3 cookies)', () => {
  const cookies = { orguseridp: '123', ssid: 'abc' };

  it('usa a sessão para obter o link meli.la enviando cookies e csrf', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse('<script>{"csrfToken":"tok-1"}</script>'))
      .mockResolvedValueOnce(
        jsonResponse({ urls: [{ url: 'https://x', short_url: 'https://meli.la/abc123' }] }),
      );
    const link = await generateOfficialMlLink('https://www.mercadolivre.com.br/p/MLB1', cookies, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(link).toBe('https://meli.la/abc123');
    const [, postInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const headers = postInit.headers as Record<string, string>;
    expect(headers.Cookie).toBe('orguseridp=123; ssid=abc');
    expect(headers['x-csrf-token']).toBe('tok-1');
    expect(JSON.parse(String(postInit.body)).urls).toEqual([
      'https://www.mercadolivre.com.br/p/MLB1',
    ]);
  });

  it('detecta sessão expirada quando o painel redireciona para login', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse('', { url: 'https://www.mercadolivre.com.br/login?x' }));
    await expect(
      generateOfficialMlLink('https://www.mercadolivre.com.br/p/MLB1', cookies, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'ML_SESSION_EXPIRED' } satisfies Partial<MlSessionError>);
  });

  it('helpers: csrf e busca recursiva do link', () => {
    expect(extractCsrfToken('<meta name="csrf-token" content="zzz">')).toBe('zzz');
    expect(findMeliLink({ a: [{ b: 'veja https://meli.la/Q1w2 ok' }] })).toBe(
      'https://meli.la/Q1w2',
    );
    expect(findMeliLink({ a: 'nada' })).toBeUndefined();
  });

  it('adapter ML prefere o link oficial e cai para matt_word/matt_tool se falhar', async () => {
    const okGen = vi.fn().mockResolvedValue('https://meli.la/ok');
    const a = createTagAdapter('MERCADOLIVRE', { mlOfficialLink: okGen });
    const creds = {
      mattWord: 'w',
      mattTool: '1',
      mlSession: { cookies, syncedAt: '2026-09-16T00:00:00Z' },
    };
    const url = 'https://www.mercadolivre.com.br/p/MLB999';
    expect(await a.toAffiliateLink(creds, url)).toBe('https://meli.la/ok');
    // segunda chamada vem do cache
    expect(await a.toAffiliateLink(creds, url)).toBe('https://meli.la/ok');
    expect(okGen).toHaveBeenCalledTimes(1);

    const failing = createTagAdapter('MERCADOLIVRE', {
      mlOfficialLink: vi.fn().mockRejectedValue(new MlSessionError('x', 'ML_SESSION_EXPIRED')),
    });
    const fallback = await failing.toAffiliateLink(
      creds,
      'https://www.mercadolivre.com.br/p/MLB1000',
    );
    expect(fallback).toContain('matt_word=w');
    expect(fallback).toContain('matt_tool=1');

    // sem tags e com sessão inválida, o erro sobe
    await expect(
      failing.toAffiliateLink(
        { mlSession: creds.mlSession },
        'https://www.mercadolivre.com.br/p/MLB1001',
      ),
    ).rejects.toBeInstanceOf(MlSessionError);
    // sessão sincronizada basta para a conexão ser considerada OK
    expect((await a.checkConnection({ mlSession: creds.mlSession })).ok).toBe(true);
  });
});

describe('Oferta Relâmpago (ML)', () => {
  const now = new Date('2026-09-16T15:00:00.000Z');
  const load = (html: string) => cheerio.load(html);

  it('sem selo não marca oferta', () => {
    const $ = load('<body>Produto comum</body>');
    expect(detectFlashSaleEnd($, $('body').text(), '', now)).toBeUndefined();
  });

  it('usa a contagem regressiva "Termina em"', () => {
    const html =
      '<body><span class="ui-pdp-promotions-pill-label">Oferta relâmpago</span> Termina em 01:30:00</body>';
    const $ = load(html);
    expect(detectFlashSaleEnd($, $('body').text(), html, now)).toBe('2026-09-16T16:30:00.000Z');
  });

  it('usa timestamp explícito quando existe', () => {
    const html = '<body>Oferta do dia<div data-end-date="2026-09-17T02:59:59.000Z"></div></body>';
    const $ = load(html);
    expect(detectFlashSaleEnd($, $('body').text(), html, now)).toBe('2026-09-17T02:59:59.000Z');
  });

  it('só com o selo assume fim do dia em São Paulo e o scraper expõe flashSaleEndsAt', () => {
    const html =
      '<body><h1 class="ui-pdp-title">TV</h1><span class="ui-pdp-promotions-pill-label">OFERTA RELÂMPAGO</span></body>';
    const $ = load(html);
    expect(detectFlashSaleEnd($, $('body').text(), html, now)).toBe('2026-09-17T02:59:59.000Z');
    const p = parseMercadoLivreHtml(html, 'https://www.mercadolivre.com.br/p/MLB1');
    expect(p.flashSaleEndsAt).toBeDefined();
    expect((p.raw as { flashSale: boolean }).flashSale).toBe(true);
  });
});
