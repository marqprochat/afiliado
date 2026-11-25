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
 * Sufixo que o scraper da Amazon cola no título ("gigante59 offOferta Black FridayDe",
 * "PlayStation 535 offOferta…"). O desconto tem no máximo 2 dígitos, então em "PlayStation 535"
 * só o "35" sai e o "5" do console fica.
 */
const AMAZON_SCRAPER_SUFFIX = /\d{1,2}\s*off\s*oferta.*$/i;

export function stripScraperSuffix(title: string): string {
  return title.replace(AMAZON_SCRAPER_SUFFIX, '').trim();
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
  let text = stripScraperSuffix(rawTitle.trim());

  for (const pattern of NOISE_WORDS) {
    text = text.replace(pattern, ' ');
  }

  text = text.replace(/(\d+),(\d+)/g, '$1.$2');
  text = normalizeSynonyms(text);
  // Antes de remover os símbolos: o "+" do modelo e as aspas de polegada distinguem variantes
  // ("S24+" ≠ "S24", 55" ≠ 50"). Só muda cleanTitle/slug de produtos NOVOS; os gravados ficam.
  text = text
    .replace(/\b([a-z]+\d+)\+/gi, '$1 plus')
    .replace(/(\d)\s?(?:''|["″“”])/g, '$1 pol');

  text = text
    .replace(/[^\w\s\d.\-áàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/gi, ' ')
    // O ponto só fica entre dígitos ("23.8"): é o que separa 23.8" de 24" e 6.1" de 6.7".
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
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

  const stopWords = new Set([
    'de', 'da', 'do', 'dos', 'das', 'com', 'para', 'em', 'um', 'uma', 'e', 'a', 'o', 'sem',
    'pol', 'polegadas',
  ]);
  // Só para comparar: "256 GB" e "256GB" viram o mesmo token (cleanTitle/slug não mudam).
  const rawTokens = normalizedLower
    .replace(/(\d)\s+(gb|tb)\b/g, '$1$2')
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

// ---------------------------------------------------------------------------
// Atributos de variante: o que separa produtos de títulos parecidos
// ---------------------------------------------------------------------------

export interface VariantAttributes {
  /** Armazenamento ("256gb", "1tb"). */
  storage?: string | undefined;
  /** Memória RAM ("8gb"). */
  ram?: string | undefined;
  /** Tamanho de tela em polegadas ("55", "6.7"). */
  inches?: string | undefined;
  /** "110" (110/127 V), "220" ou "bivolt". */
  voltage?: string | undefined;
  /** "112" (unidades/peças/itens/cápsulas), "kit2", "3em1". */
  quantity?: string | undefined;
  /** Tamanho de roupa/fralda ("m", "xg") ou numeração de calçado ("42"). */
  size?: string | undefined;
  /** Códigos de modelo (letras + dígitos) e linha da família ("iphone17", "galaxys26", "ps5"). */
  modelTokens: string[];
  /** Subconjunto ordenado de {pro, max, ultra, plus, lite, mini, se, fe, neo}. */
  tierWords: string[];
}

/** Texto base das regras de variante: sem acentos, minúsculo, sem o lixo do scraper. */
function variantText(title: string): string {
  return removeAccents(stripScraperSuffix(title).toLowerCase())
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[“”″]/g, '"')
    .replace(/\bwi-?fi\b/g, 'wifi')
    .replace(/\b([a-z]+\d+)\+/g, '$1 plus'); // "S24+" → "s24 plus"
}

const GB_VALUE = /(\d+(?:\.\d+)?)\s?(gb|tb)\b/g;

function extractMemory(text: string): { storage?: string; ram?: string } {
  let ram: string | undefined;
  const unlabeled: { value: string; gb: number }[] = [];
  for (const m of text.matchAll(GB_VALUE)) {
    const num = Number(m[1]);
    const value = `${num}${m[2]}`;
    const start = m.index ?? 0;
    const before = text.slice(0, start);
    const after = text.slice(start + m[0].length);
    const isRam =
      /^\s*(?:de\s+)?(?:memoria\s+)?ram\b/.test(after) ||
      /\bram\s*(?:de\s*)?:?\s*$/.test(before);
    if (isRam) {
      ram ??= value;
    } else {
      unlabeled.push({ value, gb: m[2] === 'tb' ? num * 1024 : num });
    }
  }
  if (unlabeled.length === 0) return ram ? { ram } : {};
  const sorted = [...unlabeled].sort((a, b) => b.gb - a.gb);
  const storage = sorted[0]!.value;
  // "Moto G86 256GB 8GB" sem a palavra RAM: o menor valor (até 32 GB) é a RAM.
  const smallest = sorted[sorted.length - 1]!;
  if (!ram && sorted.length > 1 && smallest.value !== storage && smallest.gb <= 32) {
    ram = smallest.value;
  }
  return ram ? { storage, ram } : { storage };
}

function extractInches(text: string): string | undefined {
  const explicit = text.match(/\b(\d{2,3}(?:\.\d+)?|\d\.\d+)\s?(?:polegadas|pol\b|"|'')/);
  if (explicit) return String(Number(explicit[1]));
  const afterTv = text.match(/\b(?:tv|monitor)\s+(\d{2}(?:\.\d)?)\b(?!\s?(?:gb|tb|hz|w\b|v\b|cm|mm|%))/);
  if (afterTv) return String(Number(afterTv[1]));
  return undefined;
}

function extractVoltage(text: string): string | undefined {
  if (/\bbivolt\b/.test(text)) return 'bivolt';
  const found = new Set<string>();
  const re =
    /\b(110|127|220)\s?(?:v|volts?)?\b(?!\s*(?:unid|un\b|pecas|pcs|itens|capsulas|ml\b|g\b|gb|tb|mm|cm|w\b|l\b|kg|hz|mah|%))/g;
  for (const m of text.matchAll(re)) found.add(m[1] === '220' ? '220' : '110');
  if (found.size > 1) return 'bivolt';
  return found.values().next().value;
}

function extractQuantity(text: string): string | undefined {
  const units = text.match(
    /\b(\d+)\s?(?:unidades|unidade|unid|un|pecas|pcs|itens|capsulas)\b/,
  );
  if (units) return String(Number(units[1]));
  const kit = text.match(/\bkit\s?(?:com\s)?(\d+)\b/);
  if (kit) return `kit${Number(kit[1])}`;
  const inOne = text.match(/\b(\d+)\s?em\s?1\b/);
  if (inOne) return `${Number(inOne[1])}em1`;
  return undefined;
}

/** Contexto de calçado: só então a numeração 33–46 é tamanho. */
const FOOTWEAR_CONTEXT = /\b(tenis|calcados?|sapatos?|sapatenis|sandalias?|chinelos?|botas?|chuteiras?)\b/;
/** Contexto de roupa/fralda: só então letras soltas (p, m, g…) são tamanho. */
const APPAREL_CONTEXT =
  /\b(fraldas?|pampers|huggies|babysec|mamypoko|roupas?|camisetas?|camisas?|blusas?|calcas?|shorts?|bermudas?|vestidos?|cuecas?|calcinhas?|sutias?|meias?|pijamas?|jaquetas?|casacos?|moletom|moletons|leggings?|body|bodies|macacao|macaquinho|uniformes?|polo|regata|biquini|maio)\b/;

function extractSize(text: string): string | undefined {
  if (FOOTWEAR_CONTEXT.test(text)) {
    const shoe = text.match(/\b(3[3-9]|4[0-6])\b(?!\s?(?:unid|un\b|pecas|cm|mm|%|gb|ml|l\b))/);
    if (shoe) return shoe[1];
  }
  if (APPAREL_CONTEXT.test(text)) {
    const letter = text.match(/(?<![\d.]\s?)\b(rn|pp|p|m|g|gg|xg|xxg|xxxg|eg|egg|exg)\b/);
    if (letter) return letter[1];
  }
  return undefined;
}

/**
 * Tokens com letras e dígitos que NÃO identificam modelo (stoplist):
 * - começando por número + unidade: 5g, 4g, 4k, 8k, 2k, 1080p, 120hz, 48mp, 5000mah, 65w, 110v,
 *   4.1l, 500ml, 2kg, 12x, 2a/1o (ordinais), 256gb, 8gb, 1tb…
 * - termos técnicos genéricos: wifi6, ipx4, ip67, usb3, bt5, hdmi2, mp3/mp4, h264/h265, ddr4/ddr5,
 *   lpddr5, pcie4, gen4, nfc, lte, ufs3, fhd/uhd/hd + número, rgb/led + número, x2 (multiplicador).
 */
const UNIT_TOKEN =
  /^\d+(?:\.\d+)?(?:gb|tb|mb|kb|mah|wh|w|kw|v|vac|hz|khz|mhz|ghz|ml|l|lt|kg|g|mg|mm|cm|m|mp|x|k|p|fps|rpm|btu|btus|a|o|un|pol|pcs|gbps|mbps|db|lm|nm|ms|min|h|s|ch|c|cv|th|nd|rd|st|oz|lb|em1)$/;
const GENERIC_TOKEN =
  /^(?:wifi\d*|ipx?\d+|usb\d*|bt\d*|hdmi\d*|mp[34]|h26[45]|ddr\d*|lpddr\d*|pcie\d*|gen\d+|nfc\d*|lte\d*|ufs\d*|fhd\d*|uhd\d*|hd\d*|rgb\d*|led\d*|x\d)$/;

/**
 * Número da linha logo após o nome da família ("iphone 17" → "iphone17", "galaxy s26" →
 * "galaxys26", "moto g86" → "motog86", "playstation 5"/"ps 5" → "ps5", "série 3000" → "series3000").
 */
const FAMILY_PATTERNS: { re: RegExp; token: (m: RegExpMatchArray) => string }[] = [
  { re: /\b(iphone|ipad|pixel|redmi|airpods|kindle)\s+(\d{1,3})\b/g, token: (m) => `${m[1]}${m[2]}` },
  { re: /\bnote\s+(\d{1,3})\b/g, token: (m) => `note${m[1]}` },
  { re: /\bgalaxy\s+(?:tab\s+)?([a-z])\s?(\d{1,3})\b/g, token: (m) => `galaxy${m[0].includes('tab') ? 'tab' : ''}${m[1]}${m[2]}` },
  { re: /\bgalaxy\s+(?:z\s+)?(fold|flip)\s?(\d{1,2})\b/g, token: (m) => `${m[1]}${m[2]}` },
  { re: /\bmoto\s+([a-z])\s?(\d{1,3})\b/g, token: (m) => `moto${m[1]}${m[2]}` },
  { re: /\b(?:playstation|ps)\s?(\d)\b/g, token: (m) => `ps${m[1]}` },
  { re: /\bswitch\s+(\d)\b/g, token: (m) => `switch${m[1]}` },
  { re: /\bwatch\s+(\d{1,2})\b/g, token: (m) => `watch${m[1]}` },
  { re: /\bseries?\s+(\d{1,4})\b/g, token: (m) => `series${m[1]}` },
];

function extractModelTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const raw of text.split(/[^a-z0-9.\-]+/)) {
    const t = raw.replace(/^[.\-]+|[.\-]+$/g, '');
    if (!t || !/[a-z]/.test(t) || !/\d/.test(t)) continue;
    if (UNIT_TOKEN.test(t)) continue;
    const compact = t.replace(/[.\-]/g, '');
    if (GENERIC_TOKEN.test(compact) || UNIT_TOKEN.test(compact)) continue;
    tokens.add(compact);
  }
  for (const { re, token } of FAMILY_PATTERNS) {
    for (const m of text.matchAll(re)) tokens.add(token(m));
  }
  return [...tokens];
}

function extractTierWords(text: string): string[] {
  const tiers = new Set<string>();
  for (const m of text.matchAll(/\b(pro|max|ultra|plus|lite|mini|neo)\b/g)) tiers.add(m[1]!);
  // "se"/"fe" também são palavras comuns: só contam logo depois de família/modelo.
  for (const m of text.matchAll(/\b(?:iphone|watch|galaxy|[a-z]{0,2}\d{1,3})\s+(se|fe)\b/g)) {
    tiers.add(m[1]!);
  }
  return [...tiers].sort();
}

/** Extrai do título os atributos que distinguem variantes do mesmo produto. */
export function extractVariantAttributes(title: string): VariantAttributes {
  const text = variantText(title);
  return {
    ...extractMemory(text),
    inches: extractInches(text),
    voltage: extractVoltage(text),
    quantity: extractQuantity(text),
    size: extractSize(text),
    modelTokens: extractModelTokens(text),
    tierWords: extractTierWords(text),
  };
}

/**
 * Dois códigos de modelo são o mesmo quando iguais ou quando um começa com o outro, o menor tem
 * ≥ 5 caracteres e o que sobra começa com letra (sufixo de região/cor: "un55m75h" ~
 * "un55m75hagxzd", "mpn01" ~ "mpn01b"; mas "series3" ≠ "series30").
 */
function sameModelToken(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short) && /[a-z]/.test(long[short.length]!);
}

function sharedModelTokens(a: VariantAttributes, b: VariantAttributes): string[] {
  return a.modelTokens.filter((x) => b.modelTokens.some((y) => sameModelToken(x, y)));
}

const SCALAR_ATTRIBUTES = ['storage', 'ram', 'inches', 'voltage', 'quantity', 'size'] as const;

const ACCESSORY_HINT =
  /\b(capa|capinha|case|pelicula|pel[ií]cula|suporte|controle|cabo|carregador|adaptador|pulseira|alca|al[cç]a|protetor|protetora|bag|bolsa|mochila)\b/i;

function accessoryMismatch(titleA: string, titleB: string): boolean {
  const normA = removeAccents(titleA);
  const normB = removeAccents(titleB);
  return ACCESSORY_HINT.test(normA) !== ACCESSORY_HINT.test(normB);
}

/** true quando os títulos descrevem variantes diferentes (na dúvida entre atributos presentes, separa). */
export function variantsConflict(a: VariantAttributes, b: VariantAttributes): boolean {
  for (const key of SCALAR_ATTRIBUTES) {
    const va = a[key];
    const vb = b[key];
    if (va && vb && va !== vb) return true;
  }
  const hasModelA = a.modelTokens.length > 0;
  const hasModelB = b.modelTokens.length > 0;
  if (hasModelA && hasModelB && sharedModelTokens(a, b).length === 0) return true;
  if ((hasModelA || hasModelB) && a.tierWords.join(',') !== b.tierWords.join(',')) return true;
  return false;
}

/** EAN válido (≥ 8 caracteres) ou null. */
export function cleanEanValue(ean: string | null | undefined): string | null {
  const v = ean?.trim();
  return v && v.length >= 8 ? v : null;
}

/**
 * Conflito de variantes entre dois títulos. Só conta se aparece nos títulos como vieram E depois
 * de passar os dois pela mesma normalização (normalizeProductTitle): assim um título bruto nunca
 * conflita com o próprio cleanTitle, que é o título gravado na página do produto.
 */
function titlesConflict(titleA: string, titleB: string): boolean {
  if (accessoryMismatch(titleA, titleB)) return true;
  if (!variantsConflict(extractVariantAttributes(titleA), extractVariantAttributes(titleB))) {
    return false;
  }
  return variantsConflict(
    extractVariantAttributes(normalizeProductTitle(titleA).cleanTitle),
    extractVariantAttributes(normalizeProductTitle(titleB).cleanTitle),
  );
}

/**
 * true quando dois produtos certamente são diferentes: EANs válidos e diferentes, ou variantes em
 * conflito. EAN igual vence o título.
 */
export function productsConflict(
  a: { title: string; ean?: string | null | undefined },
  b: { title: string; ean?: string | null | undefined },
): boolean {
  const eanA = cleanEanValue(a.ean);
  const eanB = cleanEanValue(b.ean);
  if (eanA && eanB) return eanA !== eanB;
  return titlesConflict(a.title, b.title);
}

/** O que a normalização antiga apagava do título: "+" do modelo e aspas de polegada. */
function stripLegacySymbols(title: string): string {
  return title.replace(/[+"″“”]|''/g, ' ');
}

/**
 * Uma listagem que JÁ está num produto só sai dele quando certamente é outro produto. Páginas
 * gravadas antes da correção perderam o "+" e as aspas no título ("Galaxy S24+" virou
 * "Galaxy S24"): o conflito só conta se persistir com esses símbolos removidos também da listagem.
 */
export function listingConflictsWithMaster(
  listing: { title: string; ean?: string | null | undefined },
  master: { title: string; ean?: string | null | undefined },
): boolean {
  if (!productsConflict(listing, master)) return false;
  return productsConflict({ ...listing, title: stripLegacySymbols(listing.title) }, master);
}

/** Diferença de preço máxima aceita entre o produto e o candidato. */
export const MAX_MATCH_PRICE_RATIO = 1.8;
/** Score mínimo padrão (75% tokens + 25% Levenshtein, + bônus por código de modelo). */
export const DEFAULT_MATCH_THRESHOLD = 0.68;
/** Bônus quando os dois títulos citam o mesmo código de modelo longo (≥ 5 caracteres). */
const MODEL_CODE_BONUS = 0.2;

export function findBestProductMatch(
  newProduct: ProductInput,
  candidates: MatchingCandidate[],
  threshold = DEFAULT_MATCH_THRESHOLD,
): MatchingCandidate | null {
  const newEan = cleanEanValue(newProduct.ean);
  if (newEan) {
    const matchEan = candidates.find((c) => cleanEanValue(c.ean) === newEan);
    if (matchEan) return matchEan;
  }

  const normNew = normalizeProductTitle(newProduct.title);
  const variantNew = extractVariantAttributes(newProduct.title);
  const detectedBrand = newProduct.brand || normNew.brand;

  let bestScore = 0;
  let bestCandidate: MatchingCandidate | null = null;

  for (const candidate of candidates) {
    const candEan = cleanEanValue(candidate.ean);
    if (newEan && candEan && newEan !== candEan) continue;

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

    if (priceRatio > MAX_MATCH_PRICE_RATIO) {
      continue;
    }

    if (accessoryMismatch(newProduct.title, candidate.title)) {
      continue;
    }

    const variantCand = extractVariantAttributes(candidate.title);
    if (variantsConflict(variantNew, variantCand) && titlesConflict(newProduct.title, candidate.title)) {
      continue;
    }

    const tokenSim = calculateTokenSimilarity(normNew.tokens, normCand.tokens);
    const strSim = stringSimilarity(normNew.cleanTitle, normCand.cleanTitle);

    let score = tokenSim * 0.75 + strSim * 0.25;
    if (sharedModelTokens(variantNew, variantCand).some((t) => t.length >= 5)) {
      score += MODEL_CODE_BONUS;
    }

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
