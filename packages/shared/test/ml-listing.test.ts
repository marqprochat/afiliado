import { describe, expect, it } from 'vitest';
import { matchesSearchKeywords, searchQuerySchema } from '../src/search';
import { marketplaceUpdateSchema } from '../src/api';
import { ML_DEAL_CATEGORIES } from '../src/marketplaces';
import { QUEUE_ML_LINKS_PREWARM } from '../src/queues';

const base = { source: 'MERCADOLIVRE', mode: 'listing' } as const;

describe('searchQuerySchema: listagem do Mercado Livre', () => {
  it('aceita ofertas do dia e relâmpago só com o tipo', () => {
    const deals = searchQuerySchema.parse({ ...base, mlListing: { kind: 'deals' } });
    expect(deals.mlListing).toEqual({ kind: 'deals' });
    const lightning = searchQuerySchema.parse({ ...base, mlListing: { kind: 'lightning' } });
    expect(lightning.mlListing?.kind).toBe('lightning');
  });

  it('exige categoryId MLB… quando o tipo é categoria', () => {
    expect(() => searchQuerySchema.parse({ ...base, mlListing: { kind: 'category' } })).toThrow();
    expect(() =>
      searchQuerySchema.parse({ ...base, mlListing: { kind: 'category', categoryId: 'abc' } }),
    ).toThrow();
    const ok = searchQuerySchema.parse({
      ...base,
      mlListing: { kind: 'category', categoryId: 'MLB1051' },
    });
    expect(ok.mlListing?.categoryId).toBe('MLB1051');
  });

  it('não aceita mais o tipo url (URL colada): a extensão já cobre esse caso', () => {
    expect(() =>
      searchQuerySchema.parse({
        ...base,
        mlListing: { kind: 'url', url: 'https://www.mercadolivre.com.br/ofertas' },
      }),
    ).toThrow();
  });

  it('exige mlListing no modo listing', () => {
    expect(() => searchQuerySchema.parse(base)).toThrow();
  });

  it('rejeita o modo listing fora do Mercado Livre', () => {
    expect(() =>
      searchQuerySchema.parse({
        source: 'SHOPEE',
        mode: 'listing',
        mlListing: { kind: 'deals' },
      }),
    ).toThrow();
  });
});

describe('marketplaceUpdateSchema: mlTag', () => {
  it('apara espaços e aceita vazio (limpar a etiqueta)', () => {
    expect(marketplaceUpdateSchema.parse({ mlTag: '  minha-tag ' }).mlTag).toBe('minha-tag');
    expect(marketplaceUpdateSchema.parse({ mlTag: '' }).mlTag).toBe('');
  });

  it('limita o tamanho', () => {
    expect(() => marketplaceUpdateSchema.parse({ mlTag: 'x'.repeat(101) })).toThrow();
  });
});

describe('ML_DEAL_CATEGORIES', () => {
  it('tem ids MLB… únicos e rótulos preenchidos', () => {
    expect(ML_DEAL_CATEGORIES.length).toBeGreaterThan(5);
    const ids = ML_DEAL_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ML_DEAL_CATEGORIES) {
      expect(c.id).toMatch(/^MLB\d+$/);
      expect(c.label.length).toBeGreaterThan(2);
    }
  });
});

describe('matchesSearchKeywords', () => {
  it('exige todas as palavras, ignorando acentos, maiúsculas e a ordem', () => {
    const title = 'Fone de Ouvido Bluetooth Sem Fio JBL';
    expect(matchesSearchKeywords(title, 'fone bluetooth')).toBe(true);
    expect(matchesSearchKeywords(title, 'JBL fone')).toBe(true);
    expect(matchesSearchKeywords('Câmera de Segurança Wifi', 'camera seguranca')).toBe(true);
    expect(matchesSearchKeywords(title, 'fone gamer')).toBe(false);
  });

  it('consulta vazia ou só espaços aceita qualquer título', () => {
    expect(matchesSearchKeywords('Qualquer coisa', '')).toBe(true);
    expect(matchesSearchKeywords('Qualquer coisa', '   ')).toBe(true);
  });
});

describe('fila de pré-aquecimento', () => {
  it('expõe o nome da fila', () => {
    expect(QUEUE_ML_LINKS_PREWARM).toBe('ml-links-prewarm');
  });
});
