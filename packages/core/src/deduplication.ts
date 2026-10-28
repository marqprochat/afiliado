/**
 * deduplication.ts - Motor de normalização, deduplicação (fuzzy matching)
 * e análise de promoções reais para o PriceEngine & Deals Hub.
 */

// Marcas comuns para extração inteligente e desempate
export const KNOWN_BRANDS = [
  'apple',
  'samsung',
  'xiaomi',
  'motorola',
  'lg',
  'sony',
  'jbl',
  'philips',
  'mondial',
  'britania',
  'oster',
  'electrolux',
  'brastemp',
  'consul',
  'asus',
  'lenovo',
  'dell',
  'acer',
  'playstation',
  'nintendo',
  'xbox',
  'logitech',
  'redragon',
  'hyperx',
  'razer',
  'anker',
  'baseus',
  'multilaser',
  'positivo',
  'tcl',
  'panasonic',
  'arno',
  'tramontina',
  'midea',
  'walita',
];

// Termos de ruído publicitário em marketplaces
const NOISE_WORDS = [
  /\b(frete\s+gr[aá]tis)\b/gi,
  /\b(pronta\s+entrega)\b/gi,
  /\b(envio|entrega)\s+(imediato|r[aá]pido|hoje|full)\b/gi,
  /\b(original|100%\s+original|aut[eê]ntico)\b/gi,
  /\b(com\s+nota\s+fiscal|com\s+nf|nf-e|lacrado)\b/gi,
  /\b(novo|lan[cç]amento|imperd[ií]vel|oferta|promo[cç][aã]o|promo)\b/gi,
  /\b(garantia\s+de\s+\d+\s*(meses|ano|dias))\b/gi,
  /\b(oficial|loja\s+oficial)\b/gi,
  /\b(em\s+at[eé]\s+\d+x\s+sem\s+juros)\b/gi,
  /\b(brinde|compre\s+agora|confira)\b/gi,
  /[!★⭐🔥💥✨🚀👍🏷️💰❤️]/g,
];

function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeSynonyms(str: string): string {
  return str
    .replace(/\bairfryer\b/gi, 'air fryer')
    .replace(/\bsmarttv\b/gi, 'smart tv')
    .replace(/\bwi-?fi\b/gi, 'wifi')
    .replace(/\blitros?\b/gi, 'l')
    .replace(/\b(preto|preta)\b/gi, 'preto')
    .replace(/\b(branco|branca)\b/gi, 'branco')
    .replace(/\b(cinza|grafite)\b/gi, 'cinza')
    .replace(/\b(azul|blue)\b/gi, 'azul');
}

/**
 * Limpa títulos poluídos de marketplaces, extrai marca conhecida e gera slug canônico.
 */
export function normalizeProductTitle(rawTitle: string): {
  cleanTitle: string;
  slug: string;
  brand?: string | undefined;
  tokens: string[];
} {
  let text = rawTitle.trim();

  for (const pattern of NOISE_WORDS) {
    text = text.replace(pattern, ' ');
  }

  text = text.replace(/(\d+),(\d+)/g, '$1.$2');
  text = normalizeSynonyms(text);

  text = text
    .replace(/[^\w\s\d\-áàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedLower = removeAccents(text.toLowerCase());

  let brand: string | undefined = undefined;
  for (const b of KNOWN_BRANDS) {
    const regex = new RegExp(`\\b${b}\\b`, 'i');
    if (regex.test(normalizedLower)) {
      brand = b.charAt(0).toUpperCase() + b.slice(1);
      break;
    }
  }

  const stopWords = new Set(['de', 'da', 'do', 'dos', 'das', 'com', 'para', 'em', 'um', 'uma', 'e', 'a', 'o', 'sem']);
  const rawTokens = normalizedLower
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !stopWords.has(t));

  const slug = removeAccents(text.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return {
    cleanTitle: text,
    slug: slug || `produto-${Date.now()}`,
    brand,
    tokens: rawTokens,
  };
}

export function calculateTokenSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersectionCount = 0;
  for (const t of setA) {
    if (setB.has(t)) intersectionCount++;
  }

  return (2 * intersectionCount) / (tokensA.length + tokensB.length);
}

export function stringSimilarity(strA: string, strB: string): number {
  const s1 = removeAccents(strA.toLowerCase().trim());
  const s2 = removeAccents(strB.toLowerCase().trim());
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) {
    const row = matrix[i];
    if (row) row[0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    const firstRow = matrix[0];
    if (firstRow) firstRow[j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    const prevRow = matrix[i - 1];
    const currRow = matrix[i];
    if (!prevRow || !currRow) continue;

    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      const valTop = prevRow[j] ?? 0;
      const valLeft = currRow[j - 1] ?? 0;
      const valDiag = prevRow[j - 1] ?? 0;

      currRow[j] = Math.min(
        valTop + 1,
        valLeft + 1,
        valDiag + cost,
      );
    }
  }

  const lastRow = matrix[len1];
  const distance = lastRow ? (lastRow[len2] ?? 0) : 0;
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen;
}

export interface MatchingCandidate {
  id: string;
  title: string;
  ean?: string | null | undefined;
  brand?: string | null | undefined;
  currentBestPrice: number;
}

export interface ProductInput {
  title: string;
  ean?: string | null | undefined;
  brand?: string | null | undefined;
  price: number;
}

export function findBestProductMatch(
  newProduct: ProductInput,
  candidates: MatchingCandidate[],
  threshold = 0.4,
): MatchingCandidate | null {
  if (newProduct.ean && newProduct.ean.trim().length >= 8) {
    const cleanEan = newProduct.ean.trim();
    const matchEan = candidates.find((c) => c.ean && c.ean.trim() === cleanEan);
    if (matchEan) return matchEan;
  }

  const normNew = normalizeProductTitle(newProduct.title);
  const detectedBrand = newProduct.brand || normNew.brand;

  let bestScore = 0;
  let bestCandidate: MatchingCandidate | null = null;

  for (const candidate of candidates) {
    const normCand = normalizeProductTitle(candidate.title);
    const candBrand = candidate.brand || normCand.brand;

    if (
      detectedBrand &&
      candBrand &&
      detectedBrand.toLowerCase() !== candBrand.toLowerCase()
    ) {
      continue;
    }

    const priceRatio = candidate.currentBestPrice > 0 && newProduct.price > 0
      ? Math.max(candidate.currentBestPrice, newProduct.price) /
        Math.min(candidate.currentBestPrice, newProduct.price)
      : 1;

    if (priceRatio > 3.5) {
      continue;
    }

    const tokenSim = calculateTokenSimilarity(normNew.tokens, normCand.tokens);
    const strSim = stringSimilarity(normNew.cleanTitle, normCand.cleanTitle);

    const score = tokenSim * 0.75 + strSim * 0.25;

    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

export type DealBadge = 'ALL_TIME_LOW' | 'GREAT_DEAL' | 'FAIR_PRICE' | 'INFLATED_DISCOUNT';

export interface DealAnalysis {
  badge: DealBadge;
  badgeLabel: string;
  averagePrice: number;
  lowestPriceEver: number;
  realDiscountPct: number;
  isRealPromotion: boolean;
}

export function analyzeDealPromotion(
  priceHistory: { price: number; recordedAt?: Date | string | undefined }[],
  currentPrice: number,
  originalPrice?: number | null | undefined,
): DealAnalysis {
  const prices = priceHistory.map((p) => Number(p.price)).filter((p) => p > 0);

  if (prices.length === 0) {
    const orig = Number(originalPrice ?? 0);
    const hasDiscount = orig > currentPrice;
    const discountPct = hasDiscount ? Math.round(((orig - currentPrice) / orig) * 100) : 0;

    return {
      badge: discountPct >= 20 ? 'GREAT_DEAL' : 'FAIR_PRICE',
      badgeLabel: discountPct >= 20 ? 'Oferta do Dia' : 'Preço Normal',
      averagePrice: currentPrice,
      lowestPriceEver: currentPrice,
      realDiscountPct: discountPct,
      isRealPromotion: discountPct > 5,
    };
  }

  const sum = prices.reduce((a, b) => a + b, 0);
  const averagePrice = Number((sum / prices.length).toFixed(2));
  const lowestPriceEver = Math.min(...prices, currentPrice);

  const discountVsAverage = averagePrice > 0
    ? Math.round(((averagePrice - currentPrice) / averagePrice) * 100)
    : 0;

  const orig = Number(originalPrice ?? 0);
  if (orig > currentPrice && currentPrice >= averagePrice * 0.98) {
    return {
      badge: 'INFLATED_DISCOUNT',
      badgeLabel: 'Preço Maquiado',
      averagePrice,
      lowestPriceEver,
      realDiscountPct: 0,
      isRealPromotion: false,
    };
  }

  if (currentPrice <= lowestPriceEver) {
    return {
      badge: 'ALL_TIME_LOW',
      badgeLabel: 'Menor Preço Histórico',
      averagePrice,
      lowestPriceEver,
      realDiscountPct: Math.max(discountVsAverage, 1),
      isRealPromotion: true,
    };
  }

  if (discountVsAverage >= 10) {
    return {
      badge: 'GREAT_DEAL',
      badgeLabel: `${discountVsAverage}% Abaixo da Média`,
      averagePrice,
      lowestPriceEver,
      realDiscountPct: discountVsAverage,
      isRealPromotion: true,
    };
  }

  return {
    badge: 'FAIR_PRICE',
    badgeLabel: 'Preço Regular',
    averagePrice,
    lowestPriceEver,
    realDiscountPct: Math.max(0, discountVsAverage),
    isRealPromotion: false,
  };
}
