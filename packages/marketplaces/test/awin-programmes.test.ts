import { describe, it, expect, vi } from 'vitest';
import {
  listAwinProgrammes,
  extractCleanDomain,
  mapProgrammesToDomains,
  buildAwinTrackingLink,
  generateAwinTrackingLinkViaApi,
  DEFAULT_AWIN_PARTNERS,
} from '../src/awin/programmes';
import { createAwinAdapter } from '../src/awin/adapter';

describe('Awin Programmes & Tracking Link Builder', () => {
  it('extractCleanDomain extrai domínios corretamente', () => {
    expect(extractCleanDomain('https://www.drogal.com.br/produto/p')).toBe('drogal.com.br');
    expect(extractCleanDomain('http://drogal.com.br')).toBe('drogal.com.br');
    expect(extractCleanDomain('drogal.com.br')).toBe('drogal.com.br');
    expect(extractCleanDomain('https://sub.loja.com:8080/path')).toBe('sub.loja.com');
  });

  it('mapProgrammesToDomains indexa os programas pelo domínio', () => {
    const programmes = [
      {
        id: 68224,
        name: 'Drogal BR',
        displayUrl: 'http://www.drogal.com.br',
      },
      {
        id: 12345,
        name: 'Loja Teste',
        displayUrl: 'https://lojateste.com.br/home',
      },
    ];

    const mapped = mapProgrammesToDomains(programmes);
    expect(mapped['drogal.com.br']).toEqual({
      advertiserId: '68224',
      name: 'Drogal BR',
      domain: 'drogal.com.br',
      displayUrl: 'http://www.drogal.com.br',
    });
    expect(mapped['lojateste.com.br']).toBeDefined();
  });

  it('buildAwinTrackingLink gera a URL oficial canônica no padrão Awin', () => {
    const link = buildAwinTrackingLink({
      publisherId: '691887',
      advertiserId: '68224',
      destinationUrl:
        'https://www.drogal.com.br/suplemento-alimentar-digeliv-sabor-laranja-15-comprimidos-mastigaveis/p',
    });

    expect(link).toBe(
      'https://www.awin1.com/cread.php?awinmid=68224&awinaffid=691887&platform=dl&ued=https%3A%2F%2Fwww.drogal.com.br%2Fsuplemento-alimentar-digeliv-sabor-laranja-15-comprimidos-mastigaveis%2Fp',
    );
  });

  it('buildAwinTrackingLink inclui clickref quando informado', () => {
    const link = buildAwinTrackingLink({
      publisherId: '691887',
      advertiserId: '68224',
      destinationUrl: 'https://www.drogal.com.br/produto',
      subId: 'meuSubId',
    });

    expect(link).toContain('&clickref=meuSubId');
  });

  it('listAwinProgrammes busca programas da API oficial com Authorization Bearer', async () => {
    const mockFetch = vi.fn(async (url: string, opts: any) => {
      expect(url).toContain('/publishers/691887/programmes?relationship=joined');
      expect(opts.headers.Authorization).toBe('Bearer token_secret');
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 68224,
            name: 'Drogal BR',
            displayUrl: 'http://www.drogal.com.br',
          },
        ],
      } as any;
    });

    const progs = await listAwinProgrammes(
      { publisherId: '691887', offersApiToken: 'token_secret' },
      { fetchImpl: mockFetch as any },
    );

    expect(progs).toHaveLength(1);
    expect(progs[0]?.id).toBe(68224);
    expect(progs[0]?.name).toBe('Drogal BR');
  });

  it('generateAwinTrackingLinkViaApi chama API Link Builder quando token está presente', async () => {
    const mockFetch = vi.fn(async (url: string, opts: any) => {
      expect(url).toContain('/publishers/691887/linkbuilder/generate');
      const body = JSON.parse(opts.body);
      expect(body.advertiserId).toBe(68224);
      expect(body.shorten).toBe(true);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: 'https://tidd.ly/xyz123',
        }),
      } as any;
    });

    const result = await generateAwinTrackingLinkViaApi(
      { publisherId: '691887', offersApiToken: 'token_secret' },
      {
        advertiserId: '68224',
        destinationUrl: 'https://www.drogal.com.br/produto',
        shorten: true,
      },
      { fetchImpl: mockFetch as any },
    );

    expect(result.url).toBe('https://tidd.ly/xyz123');
    expect(result.shortened).toBe(true);
  });

  it('adapter.toAffiliateLink gera tracking link para parceiro Awin quando publisherId está configurado', async () => {
    const adapter = createAwinAdapter();
    const creds = {
      feedListUrl: 'https://x',
      feedIds: [],
      publisherId: '691887',
      partners: {
        'drogal.com.br': { advertiserId: '68224', name: 'Drogal BR' },
      },
    };

    const link = await adapter.toAffiliateLink(
      creds,
      'https://www.drogal.com.br/suplemento-alimentar-digeliv/p',
      'sub123',
    );

    expect(link).toBe(
      'https://www.awin1.com/cread.php?awinmid=68224&awinaffid=691887&platform=dl&ued=https%3A%2F%2Fwww.drogal.com.br%2Fsuplemento-alimentar-digeliv%2Fp&clickref=sub123',
    );
  });
});
