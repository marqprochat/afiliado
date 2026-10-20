import type { MarketplaceKind } from '@afilados/shared';

export interface CouponCandidate {
  store: MarketplaceKind | null;
  code: string;
  description: string;
  discountType: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null;
  discountValue: number | null;
  minSpend: number | null;
  expiresAt: string | null;
  sourceUrl: string | null;
}

export const STOPLIST = new Set([
  'OFF',
  'FRETE',
  'GRATIS',
  'GRÁTIS',
  'PIX',
  'BLACK',
  'FRIDAY',
  'PRIME',
  'DAY',
  'HOJE',
  'AGORA',
  'CUPOM',
  'CUPONS',
  'CUPON',
  'CODIGO',
  'CÓDIGO',
  'CODE',
  'VOUCHER',
  'VALE',
  'DESCONTO',
  'DESCONTOS',
  'PROMO',
  'PROMOÇÃO',
  'PROMOCAO',
  'PROMOCOES',
  'PROMOÇÕES',
  'LINK',
  'LINKS',
  'AQUI',
  'CONFIRA',
  'APROVEITE',
  'VALIDO',
  'VÁLIDO',
  'VALIDADE',
  'BRASIL',
  'SHOPEE',
  'AMAZON',
  'MAGALU',
  'MAGAZINE',
  'LUIZA',
  'MERCADO',
  'LIVRE',
  'MERCADOLIVRE',
  'ALIEXPRESS',
  'SITE',
  'SITES',
  'APP',
  'APLICATIVO',
  'CHECKOUT',
  'COMPRA',
  'COMPRAS',
  'COMPRE',
  'CLIQUE',
  'ACESSE',
  'PEGAR',
  'PEGUE',
  'ATIVE',
  'ATIVAR',
  'TUDO',
  'TODO',
  'TODOS',
  'TODAS',
  'TODA',
  'NOVO',
  'NOVA',
  'NOVOS',
  'NOVAS',
  'LIMITE',
  'VALOR',
  'PREÇO',
  'PRECO',
  'SOCIAL',
  'LISTA',
  'LISTAS',
  'DIRETO',
  'DIRETA',
  'OFERTA',
  'OFERTAS',
  'CORRE',
  'ATENÇÃO',
  'ATENCAO',
  'IMPERDÍVEL',
  'IMPERDIVEL',
  'EXCLUSIVO',
  'EXCLUSIVA',
  'REGRAS',
  'PAGINA',
  'PÁGINA',
  'CARRINHO',
  'BOLETO',
  'CARTAO',
  'CARTÃO',
  'REAIS',
  'PORCENTO',
  'TESTE',
]);

function parseBRL(raw: string): number | null {
  const clean = raw.trim().replace(/\s/g, '');
  if (!clean) return null;
  // Se contiver vírgula e ponto (ex: 1.500,50 ou 1,500.50)
  if (clean.includes(',') && clean.includes('.')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      // 1.500,50 -> 1500.50
      const n = parseFloat(clean.replace(/\./g, '').replace(',', '.'));
      return isNaN(n) ? null : n;
    } else {
      // 1,500.50 -> 1500.50
      const n = parseFloat(clean.replace(/,/g, ''));
      return isNaN(n) ? null : n;
    }
  }
  // Se contiver só vírgula (ex: 100,50 ou 100,)
  if (clean.includes(',')) {
    const n = parseFloat(clean.replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  // Se for número puro ou com ponto decimal (ex: 100 ou 100.50)
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function detectStoreFromUrl(urlStr: string): MarketplaceKind | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('shopee') || host === 'shp.ee') return 'SHOPEE';
    if (host.includes('mercadolivre') || host.includes('mercadolibre') || host.includes('meli.la'))
      return 'MERCADOLIVRE';
    if (host.includes('amazon') || host === 'amzn.to') return 'AMAZON';
    if (host.includes('magazineluiza') || host.includes('magazinevoce') || host.includes('magalu'))
      return 'MAGALU';
    if (host.includes('aliexpress')) return 'ALIEXPRESS';
    if (host === 'awin1.com') return 'AWIN';
  } catch {
    // Ignora URL inválida
  }
  return null;
}

function detectStoreFromText(text: string): MarketplaceKind | null {
  if (/amazon/i.test(text)) return 'AMAZON';
  if (/mercado\s*livre|mercadolivre|\bmeli\b/i.test(text)) return 'MERCADOLIVRE';
  if (/magalu|magazine\s*luiza/i.test(text)) return 'MAGALU';
  if (/shopee/i.test(text)) return 'SHOPEE';
  if (/aliexpress|\bali\b/i.test(text)) return 'ALIEXPRESS';
  return null;
}

function parseExpiresAt(text: string, now: Date): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (/v[áa]lido\s+hoje|apenas\s+hoje|s[óo]\s+hoje|expira\s+hoje/i.test(text)) {
    const d = new Date(now);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const date = d.getUTCDate();
    return `${year}-${pad(month)}-${pad(date)}T23:59:59.999-03:00`;
  }

  const match = text.match(
    /(?:v[áa]lido|at[ée]|expira)\s*(?:em\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i,
  );
  if (!match) return null;

  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  let year = match[3] ? parseInt(match[3]!, 10) : now.getUTCFullYear();
  if (year < 100) year += 2000;

  const targetDate = new Date(Date.UTC(year, month - 1, day, 23 + 3, 59, 59, 999));
  if (!match[3] && targetDate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    year += 1;
  }

  return `${year}-${pad(month)}-${pad(day)}T23:59:59.999-03:00`;
}

export function extractCodesFromBlock(block: string, urls: string[]): string[] {
  const candidates: Array<{ code: string; score: number }> = [];
  const seen = new Set<string>();

  function addCandidate(raw: string, baseScore: number) {
    const code = raw.trim().toUpperCase().replace(/^[*_`"'«»<>()#]+|[*_`"'«»<>()#]+$/g, '');
    if (code.length < 3 || code.length > 40) return;
    if (/^\d+$/.test(code)) return; // descarta números puros
    if (STOPLIST.has(code)) return; // descarta palavras comuns de anúncio
    for (const url of urls) {
      if (url.toUpperCase().includes(code)) return; // descarta substrings exatas de URL
    }
    if (seen.has(code)) return;
    seen.add(code);

    let score = baseScore;
    const hasDigits = /\d/.test(code);
    const hasLetters = /[A-Z]/.test(code);

    // Mistura de letras e números: forte indício de cupom alfanumérico (ex: 40SITETODO, VEM10, MELI30)
    if (hasDigits && hasLetters) {
      score += 50;
    }

    // Termina com OFF (ex: 40OFF, MELI30OFF)
    if (code.endsWith('OFF')) {
      score += 20;
    }

    candidates.push({ code, score });
  }

  // Padrão 1: Emoji de Cupom (ex: 🎟️ 40SITETODO)
  const emojiPattern = /(?:🎟️|🎫|🏷️)\s*[`'*"]?([A-Za-z0-9][A-Za-z0-9_-]{2,39})[`'*"]?/gu;
  let match: RegExpExecArray | null;
  while ((match = emojiPattern.exec(block)) !== null) {
    if (match[1]) addCandidate(match[1], 80);
  }

  // Padrão 2: Palavra-chave explícita com separador (ex: Cupom: 40SITETODO, Cupom - 40SITETODO)
  const explicitWithSepPattern =
    /(?:cupom|cupon|c[óo]digo|code|voucher|vale)\s*(?:de\s*desconto)?\s*(?:(?:da|do|na|no|de)?\s*(?:shopee|amazon|magalu|magazine\s*luiza|mercado\s*livre|mercadolivre|meli|aliexpress|app))*\s*[:=–—\-]\s*[`'*"]?([A-Za-z0-9][A-Za-z0-9_-]{2,39})[`'*"]?/gi;
  while ((match = explicitWithSepPattern.exec(block)) !== null) {
    if (match[1]) addCandidate(match[1], 75);
  }

  // Padrão 3: Tokens destacados entre formatação (*ABC*, `ABC`, "ABC")
  if (/cupom|cupon|c[óo]digo|voucher|desconto|use|checkout|🎟️|🎫|🏷️/i.test(block)) {
    const formattedPattern = /(?:[`*_"])([A-Za-z0-9][A-Za-z0-9_-]{2,39})(?:[`*_"])/g;
    while ((match = formattedPattern.exec(block)) !== null) {
      if (match[1]) addCandidate(match[1], 60);
    }
  }

  // Padrão 4: "use o cupom/voucher ABC"
  const usePattern =
    /(?:use(?:\s+o)?\s+(?:cupom|voucher|c[óo]digo)?)\s*[`'*"]?([A-Za-z0-9][A-Za-z0-9_-]{2,39})[`'*"]?/gi;
  while ((match = usePattern.exec(block)) !== null) {
    if (match[1]) addCandidate(match[1], 50);
  }

  // Padrão 5: Palavras-chave sem separador (ex: Cupom MELI30)
  const explicitPattern =
    /(?:cupom|cupon|c[óo]digo|code|voucher)\s*(?:(?:da|do|na|no|de)?\s*(?:shopee|amazon|magalu|magazine\s*luiza|mercado\s*livre|mercadolivre|meli|aliexpress|app))*\s+[`'*"]?([A-Za-z0-9][A-Za-z0-9_-]{2,39})[`'*"]?/gi;
  while ((match = explicitPattern.exec(block)) !== null) {
    if (match[1]) addCandidate(match[1], 40);
  }

  // Padrão 6: Varredura de tokens alfanuméricos que misturam letras e dígitos em linhas do bloco
  if (/cupom|cupon|c[óo]digo|voucher|desconto|🎟️|🎫|🏷️/i.test(block)) {
    const words = block.split(/[\s,;:!?)\]\n\r]+/);
    for (const w of words) {
      const clean = w.replace(/^[*_`"'«»<>()#]+|[*_`"'«»<>()#]+$/g, '');
      if (/\d/.test(clean) && /[A-Za-z]/.test(clean) && clean.length >= 4 && clean.length <= 30) {
        addCandidate(clean, 45);
      }
    }
  }

  // Ordena por maior pontuação (maior score primeiro)
  candidates.sort((a, b) => b.score - a.score);

  return candidates.map((c) => c.code);
}

export function parseCouponsFromText(
  text: string,
  opts?: { defaultStore?: MarketplaceKind; now?: Date },
): CouponCandidate[] {
  const now = opts?.now ?? new Date();
  if (!text || !text.trim()) return [];

  // Quebra em blocos por linhas em branco ou separadores comuns
  const rawBlocks = text.split(/\n\s*[-—–•*=_]{3,}\s*\n|\n\s*\n+/);

  const results: CouponCandidate[] = [];
  const seen = new Set<string>();

  for (const rawBlock of rawBlocks) {
    const block = rawBlock.trim();
    if (!block) continue;

    // 1. Extração de URLs do bloco
    const urlMatches = block.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
    const firstUrl = urlMatches[0] ?? null;

    // 2. Extração de códigos
    const codes = extractCodesFromBlock(block, urlMatches);
    if (codes.length === 0) continue;

    // 3. Detecção da loja
    let store: MarketplaceKind | null = null;
    for (const u of urlMatches) {
      const fromUrl = detectStoreFromUrl(u);
      if (fromUrl) {
        store = fromUrl;
        break;
      }
    }
    if (!store) {
      store = detectStoreFromText(block);
    }
    if (!store) {
      store = opts?.defaultStore ?? null;
    }

    // 4. Detecção de desconto
    let discountType: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null = null;
    let discountValue: number | null = null;

    if (/frete\s+gr[áa]tis/i.test(block)) {
      discountType = 'FREE_SHIPPING';
    } else {
      const percentMatch = block.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:off|de\s+desconto|desc\.?)?/i);
      const fixedMatch =
        block.match(/(?:R\$\s*|BRL\s*)([\d.,]+)\s*(?:off|de\s+desconto|desc\.?)/i) ??
        block.match(/(?:ganhe|desconto\s+de)\s*(?:R\$\s*)([\d.,]+)/i);

      if (percentMatch && (!fixedMatch || percentMatch.index! < fixedMatch.index!)) {
        discountType = 'PERCENT';
        discountValue = parseFloat(percentMatch[1]!.replace(',', '.'));
      } else if (fixedMatch) {
        discountType = 'FIXED';
        discountValue = parseBRL(fixedMatch[1]!);
      }
    }

    // 5. Compra mínima
    let minSpend: number | null = null;
    const minSpendMatch = block.match(
      /(?:acima\s+de|em\s+compras?(?:\s+a\s+partir)?\s+de|m[íi]nimo(?:\s+de)?|compras?\s+m[íi]nimas?(?:\s+de)?)\s*(?:R\$\s*|BRL\s*)?([\d.,]+)/i,
    );
    if (minSpendMatch && minSpendMatch[1]) {
      minSpend = parseBRL(minSpendMatch[1]);
    }

    // 6. Validade
    const expiresAt = parseExpiresAt(block, now);

    // 7. Descrição
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const description = lines.slice(0, 3).join(' — ').slice(0, 500);

    for (const code of codes) {
      const dedupKey = `${store ?? 'UNKNOWN'}:${code}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      results.push({
        store,
        code,
        description,
        discountType,
        discountValue,
        minSpend,
        expiresAt,
        sourceUrl: firstUrl,
      });
    }
  }

  return results;
}
