import { describe, expect, it } from 'vitest';
import {
  normalizeProductTitle,
  findBestProductMatch,
  analyzeDealPromotion,
  extractVariantAttributes,
  variantsConflict,
  productsConflict,
  listingConflictsWithMaster,
} from '../src/deduplication';

describe('deduplication & price engine', () => {
  it('normalizes marketplace titles removing promotional noise', () => {
    const raw = '🔥 Apple iPhone 15 128GB Preto FRETE GRÁTIS ENVIO HOJE NOVO NF-E Lacrado!';
    const norm = normalizeProductTitle(raw);

    expect(norm.brand).toBe('Apple');
    expect(norm.cleanTitle).not.toContain('FRETE GRÁTIS');
    expect(norm.cleanTitle).not.toContain('ENVIO HOJE');
    expect(norm.cleanTitle).not.toContain('🔥');
    expect(norm.tokens).toContain('iphone');
    expect(norm.tokens).toContain('128gb');
    expect(norm.slug).toContain('apple-iphone-15-128gb-preto');
  });

  it('matches products by identical EAN', () => {
    const candidate = {
      id: 'prod-1',
      title: 'Smartphone Apple iPhone 15 128GB',
      ean: '195949038234',
      brand: 'Apple',
      currentBestPrice: 4500,
    };

    const newProd = {
      title: 'iPhone 15 128 GB Preto Original Apple',
      ean: '195949038234',
      brand: 'Apple',
      price: 4399,
    };

    const match = findBestProductMatch(newProd, [candidate]);
    expect(match?.id).toBe('prod-1');
  });

  it('matches products by fuzzy token similarity when EAN is missing', () => {
    const candidate = {
      id: 'prod-airfryer',
      title: 'Fritadeira Sem Óleo Air Fryer Philips Walita Série 3000 4.1L Preta',
      ean: null,
      brand: 'Philips',
      currentBestPrice: 380,
    };

    const incoming = {
      title: 'Airfryer Philips Walita 4.1 Litros Serie 3000 Preto 110V',
      ean: null,
      brand: 'Philips',
      price: 369,
    };

    const match = findBestProductMatch(incoming, [candidate], 0.4);
    expect(match?.id).toBe('prod-airfryer');
  });

  it('does NOT match if brands are distinct', () => {
    const candidate = {
      id: 'prod-samsung',
      title: 'Smart TV 50 Polegadas 4K Samsung Crystal UHD',
      ean: null,
      brand: 'Samsung',
      currentBestPrice: 2200,
    };

    const incoming = {
      title: 'Smart TV 50 Polegadas 4K LG UHD ThinQ AI',
      ean: null,
      brand: 'LG',
      price: 2150,
    };

    const match = findBestProductMatch(incoming, [candidate]);
    expect(match).toBeNull();
  });

  it('analyzes deal and detects ALL_TIME_LOW', () => {
    const history = [
      { price: 5000 },
      { price: 4800 },
      { price: 4600 },
    ];

    const currentPrice = 4199;
    const deal = analyzeDealPromotion(history, currentPrice, 5200);

    expect(deal.badge).toBe('ALL_TIME_LOW');
    expect(deal.isRealPromotion).toBe(true);
    expect(deal.lowestPriceEver).toBe(4199);
  });

  it('detects fake promotions / inflated discounts', () => {
    const history = [
      { price: 300 },
      { price: 310 },
      { price: 295 },
    ];

    const deal = analyzeDealPromotion(history, 305, 600);
    expect(deal.badge).toBe('INFLATED_DISCOUNT');
    expect(deal.isRealPromotion).toBe(false);
  });
});

const cand = (id: string, title: string, currentBestPrice: number, ean: string | null = null) => ({
  id,
  title,
  ean,
  brand: null,
  currentBestPrice,
});
const prod = (title: string, price: number, ean: string | null = null) => ({
  title,
  ean,
  brand: null,
  price,
});

describe('limpeza do título do scraper da Amazon', () => {
  it.each([
    ['O nabo gigante59 offOferta Black FridayDe', 'O nabo gigante'],
    ['Mortal Kombat 1 - PlayStation 535 offOferta Black FridayDe', 'Mortal Kombat 1 - PlayStation 5'],
    ['Kit 3 Camisetas Basicas Algodao 50 offOferta Exclusiva PrimeDe', 'Kit 3 Camisetas Basicas Algodao'],
  ])('%s', (raw, clean) => {
    const norm = normalizeProductTitle(raw);
    expect(norm.cleanTitle).toBe(clean);
    expect(norm.slug).not.toMatch(/off|oferta|black|prime/);
  });
});

describe('extractVariantAttributes', () => {
  it('separa armazenamento de RAM em celulares', () => {
    const v = extractVariantAttributes('Smartphone Motorola Moto G86 5G 256GB 8GB RAM Cosmic');
    expect(v.storage).toBe('256gb');
    expect(v.ram).toBe('8gb');
    expect(v.modelTokens).toContain('g86');
    expect(v.modelTokens).not.toContain('5g');
  });

  it('reconhece memória RAM escrita antes do valor', () => {
    const v = extractVariantAttributes('Notebook Dell Inspiron i5 Memória RAM de 16 GB SSD 512 GB');
    expect(v.ram).toBe('16gb');
    expect(v.storage).toBe('512gb');
  });

  it('polegadas por aspas, pela palavra e pelo número depois de TV/monitor', () => {
    expect(extractVariantAttributes('Samsung UN55M75HAGXZD Smart TV 55"').inches).toBe('55');
    expect(extractVariantAttributes('Smart TV Samsung 55 polegadas UN55M75H').inches).toBe('55');
    expect(extractVariantAttributes('Smart TV 50 Samsung Crystal').inches).toBe('50');
    expect(extractVariantAttributes('Monitor 24 LG Full HD').inches).toBe('24');
  });

  it('voltagem e bivolt', () => {
    expect(extractVariantAttributes('Air Fryer Mondial 4L 220V').voltage).toBe('220');
    expect(extractVariantAttributes('Air Fryer Mondial 4L 127V').voltage).toBe('110');
    expect(extractVariantAttributes('Cafeteira Arno Bivolt').voltage).toBe('bivolt');
    expect(extractVariantAttributes('Fralda 110 unidades').voltage).toBeUndefined();
  });

  it('quantidade, tamanho (só com contexto) e tiers', () => {
    const v = extractVariantAttributes('Fralda Pampers Pants Ajuste Total Max M 112 Unidades');
    expect(v.quantity).toBe('112');
    expect(v.size).toBe('m');
    expect(extractVariantAttributes('Kit 2 Garrafas Térmicas').quantity).toBe('kit2');
    expect(extractVariantAttributes('Shampoo 3 em 1').quantity).toBe('3em1');
    expect(extractVariantAttributes('Tênis Nike Revolution Masculino 42').size).toBe('42');
    expect(extractVariantAttributes('Caixa de Som JBL G Preta').size).toBeUndefined();
    expect([...extractVariantAttributes('Apple iPhone 17 Pro Max 256 GB').tierWords].sort()).toEqual([
      'max',
      'pro',
    ]);
    expect(extractVariantAttributes('Galaxy S24+ 256GB').tierWords).toEqual(['plus']);
  });

  it('número da linha depois do nome da família vira token de modelo', () => {
    expect(extractVariantAttributes('Apple iPhone 13 128 GB').modelTokens).toContain('iphone13');
    expect(extractVariantAttributes('Console PlayStation 5 Slim').modelTokens).toContain('ps5');
    expect(extractVariantAttributes('Console PS5 Slim').modelTokens).toContain('ps5');
    expect(extractVariantAttributes('Multiprocessador Mondial MPN-01 Preto').modelTokens).toContain(
      'mpn01',
    );
  });
});

describe('variantsConflict', () => {
  it('modelo com sufixo de região casa por prefixo', () => {
    expect(
      variantsConflict(
        extractVariantAttributes('Smart TV Samsung 55 polegadas UN55M75H'),
        extractVariantAttributes('Samsung UN55M75HAGXZD Smart TV 55"'),
      ),
    ).toBe(false);
  });

  it('tier só conflita quando há família/modelo identificado', () => {
    expect(
      variantsConflict(
        extractVariantAttributes('Mini Liquidificador Portátil Rosa'),
        extractVariantAttributes('Liquidificador Portátil Rosa'),
      ),
    ).toBe(false);
  });
});

describe('findBestProductMatch não junta variantes diferentes', () => {
  it.each([
    ['iPhone 17 Pro 256 vs iPhone 17 256', 'Apple iPhone 17 Pro 256 GB - azul intenso', 8999, 'Apple iPhone 17 256 GB - azul intenso', 7999],
    ['iPhone 17 Pro 256 vs 512', 'Apple iPhone 17 Pro 256 GB - azul intenso', 8999, 'Apple iPhone 17 Pro 512 GB - azul intenso', 9590],
    ['iPhone 13 vs 14', 'Apple iPhone 13 128 GB - Meia-noite', 3999, 'Apple iPhone 14 128 GB - Meia-noite', 4299],
    ['Moto G86 vs G85', 'Smartphone Motorola Moto G86 5G 256GB 8GB RAM Cosmic', 1599, 'Smartphone Motorola Moto G85 5G 256GB 8GB RAM Cosmic', 1499],
    ['Galaxy S26 Ultra vs S26', 'Celular Samsung Galaxy S26 Ultra 5G 256GB Preto', 8999, 'Celular Samsung Galaxy S26 5G 256GB Preto', 6999],
    ['Pampers M 112 vs XG 86', 'Fralda Pampers Pants Ajuste Total Max M 112 Unidades', 199, 'Fralda Pampers Pants Ajuste Total Max XG 86 Unidades', 199],
    ['TV 55 vs 50', 'Smart TV 55 Samsung Crystal UHD 4K', 2999, 'Smart TV 50 Samsung Crystal UHD 4K', 2599],
  ])('%s', (_label, titleA, priceA, titleB, priceB) => {
    expect(findBestProductMatch(prod(titleB, priceB), [cand('a', titleA, priceA)])).toBeNull();
  });

  it('EAN diferente não é o mesmo produto', () => {
    const t = 'Apple iPhone 15 128 GB Preto';
    expect(
      findBestProductMatch(prod(t, 4500, '195949038234'), [cand('a', t, 4500, '195949038999')]),
    ).toBeNull();
  });

  it('preço 2x não junta', () => {
    const t = 'Apple iPhone 15 128 GB Preto';
    expect(findBestProductMatch(prod(t, 9000), [cand('a', t, 4500)])).toBeNull();
  });
});

describe('findBestProductMatch junta o mesmo produto', () => {
  it('mesmo iPhone 17 Pro 256 GB com cor/vendedor diferentes', () => {
    const m = findBestProductMatch(prod('iPhone 17 Pro Apple 256GB Prata - Loja Parceira', 8799), [
      cand('a', 'Apple iPhone 17 Pro 256 GB - azul intenso', 8999),
    ]);
    expect(m?.id).toBe('a');
  });

  it('TV com modelo com sufixo de região', () => {
    const m = findBestProductMatch(prod('Samsung UN55M75HAGXZD Smart TV 55"', 2899), [
      cand('a', 'Smart TV Samsung 55 polegadas UN55M75H', 2999),
    ]);
    expect(m?.id).toBe('a');
  });

  it('Multiprocessador Mondial MPN-01 de duas lojas', () => {
    const m = findBestProductMatch(
      prod('Multiprocessador Mondial Power Chef MPN-01-B 250W Preto 127V', 179),
      [cand('a', 'Multiprocessador de Alimentos Mondial MPN-01 Power Chef 250W 2 Velocidades 110V', 189)],
    );
    expect(m?.id).toBe('a');
  });

  it('prefere o candidato sem conflito entre vários', () => {
    const m = findBestProductMatch(prod('Apple iPhone 17 Pro 256GB Prata', 8799), [
      cand('pro512', 'Apple iPhone 17 Pro 512 GB - azul intenso', 9590),
      cand('base', 'Apple iPhone 17 256 GB - azul intenso', 7999),
      cand('pro256', 'Apple iPhone 17 Pro 256 GB - azul intenso', 8999),
      cand('promax', 'Apple iPhone 17 Pro Max 256 GB - azul intenso', 9999),
    ]);
    expect(m?.id).toBe('pro256');
  });
});

describe('título bruto x o próprio cleanTitle (regressão: página nova a cada envio)', () => {
  const RAW_TITLES = [
    'Samsung Galaxy S24+ 256GB Preto',
    'Smartphone Samsung Galaxy S24+ 5G 512GB 12GB RAM Violeta',
    'Apple iPhone 15 Pro Max 256GB Titânio Natural',
    'Smart TV LG 55" 4K UHD ThinQ AI 55UR8750PSA',
    'Smart TV Samsung 65″ Crystal UHD 4K',
    "TV 50'' Philco 4K",
    'Fralda Pampers Confort Sec XG 86 Unidades',
    'Smartphone Motorola Moto G86 256GB 8GB RAM 5G Cosmic Sky',
    'Monitor 24" LG 24GS60F-B UltraGear IPS 180Hz',
    'Monitor Gamer Samsung Odyssey 23,8" FHD 165Hz',
    'Air Fryer Mondial 4,1 Litros 110V Preta',
    'Kit 2 Lâmpadas LED 9W Bivolt',
    'Notebook Lenovo IdeaPad 3 Ryzen 5 8GB 256GB SSD 15.6"',
  ];

  it.each(RAW_TITLES)('%s não conflita com o próprio cleanTitle', (raw) => {
    const { cleanTitle } = normalizeProductTitle(raw);
    expect(productsConflict({ title: raw }, { title: cleanTitle })).toBe(false);
    const own = { id: 'own', title: cleanTitle, currentBestPrice: 1000 };
    expect(findBestProductMatch({ title: raw, price: 1000 }, [own])?.id).toBe('own');
  });

  it('cleanTitle novo mantém "plus" e as polegadas', () => {
    expect(normalizeProductTitle('Samsung Galaxy S24+ 256GB Preto').cleanTitle).toBe(
      'Samsung Galaxy S24 plus 256GB preto',
    );
    expect(normalizeProductTitle('Smart TV LG 55" 4K').cleanTitle).toBe('Smart TV LG 55 pol 4K');
  });

  it('S24+ continua diferente do S24', () => {
    expect(
      productsConflict(
        { title: 'Samsung Galaxy S24+ 256GB Preto' },
        { title: 'Samsung Galaxy S24 256GB Preto' },
      ),
    ).toBe(true);
  });

  it('listagem S24+ fica na página antiga cujo título perdeu o "+" (gravado antes da correção)', () => {
    expect(
      listingConflictsWithMaster(
        { title: 'Samsung Galaxy S24+ 256GB Preto' },
        { title: 'Samsung Galaxy S24 256GB preto' },
      ),
    ).toBe(false);
    expect(
      listingConflictsWithMaster(
        { title: 'Samsung Galaxy S24+ 256GB Preto' },
        { title: 'Samsung Galaxy S24 512GB preto' },
      ),
    ).toBe(true);
  });
});
