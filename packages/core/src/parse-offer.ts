import { extractUrls } from './links';
import { parseCouponsFromText, extractCodesFromBlock } from './coupon-parse';

export interface ParsedOffer {
  title?: string | undefined;
  price?: number | undefined;
  originalPrice?: number | undefined;
  discountPct?: number | undefined;
  coupon?: string | undefined;
  urls: string[];
}

function parseBrlAmount(raw: string): number | undefined {
  const clean = raw.trim().replace(/^R\$\s*/i, '');
  // Ex: "1.299,90" ou "299,00" ou "89.90" ou "89"
  const match = clean.match(/^(\d{1,3}(?:\.\d{3})*|\d+)(?:[.,](\d{1,2}))?$/);
  if (!match) return undefined;
  const intPart = match[1]!.replace(/\./g, '');
  const decPart = (match[2] ?? '00').padEnd(2, '0');
  const val = parseFloat(`${intPart}.${decPart}`);
  return isNaN(val) || val <= 0 ? undefined : val;
}

export function parseOfferText(text: string): ParsedOffer {
  const urls = extractUrls(text);

  // 1. Cupom: primeiro tenta via parseCouponsFromText ou extractCodesFromBlock
  let coupon: string | undefined;
  const parsedCoupons = parseCouponsFromText(text);
  if (parsedCoupons.length > 0 && parsedCoupons[0]?.code) {
    coupon = parsedCoupons[0].code.toUpperCase();
  } else {
    const blockCodes = extractCodesFromBlock(text, urls);
    if (blockCodes.length > 0) {
      coupon = blockCodes[0];
    }
  }


  // 2. Preço original (De: ...)
  let originalPrice: number | undefined;
  const deMatch = text.match(
    /(?:(?:❌\s*)?de\s*:?|era\s*:?|pre[çc]o\s+anterior\s*:?)\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:[.,](\d{1,2}))?/i,
  );
  if (deMatch) {
    const dec = deMatch[2] ? `,${deMatch[2]}` : '';
    originalPrice = parseBrlAmount(`${deMatch[1]}${dec}`);
  }

  // 3. Preço promocional (Por: ..., Apenas ..., Sai por ..., R$ XX no Pix)
  let price: number | undefined;
  const porMatch = text.match(
    /(?:(?:✅\s*)?(?:por\s+apenas|por\s+s[oó]|por|sai\s+por|apenas|s[oó]|pague|pagando|valor|pre[çc]o)\s*:?\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:[.,](\d{1,2}))?\s*(?:no\s+pix|à\s+vista|a\s+vista|no\s+boleto)?/i,
  );

  // Procura padrão explícito de 'por'
  const explicitPorMatch = text.match(
    /(?:(?:✅\s*)?(?:por\s+apenas|por\s+s[oó]|por|sai\s+por|apenas|s[oó]|pague|pagando)\s*:?\s*)(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:[.,](\d{1,2}))?/i,
  );
  if (explicitPorMatch) {
    const dec = explicitPorMatch[2] ? `,${explicitPorMatch[2]}` : '';
    price = parseBrlAmount(`${explicitPorMatch[1]}${dec}`);
  } else {
    // Procura por "R$ XX,XX no Pix / à vista"
    const pixMatch = text.match(
      /(?:R\$\s*)(\d{1,3}(?:\.\d{3})*|\d+)(?:[.,](\d{1,2}))?\s*(?:no\s+pix|à\s+vista|a\s+vista|no\s+boleto)/i,
    );
    if (pixMatch) {
      const dec = pixMatch[2] ? `,${pixMatch[2]}` : '';
      price = parseBrlAmount(`${pixMatch[1]}${dec}`);
    } else {
      // Procura todas as ocorrências de R$
      const allPrices: number[] = [];
      const re = /R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:[.,](\d{1,2}))?/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const dec = m[2] ? `,${m[2]}` : '';
        const parsed = parseBrlAmount(`${m[1]}${dec}`);
        if (parsed) allPrices.push(parsed);
      }

      if (allPrices.length === 1) {
        price = allPrices[0];
      } else if (allPrices.length > 1) {
        if (originalPrice && allPrices.some((p) => p !== originalPrice)) {
          price = allPrices.find((p) => p !== originalPrice);
        } else {
          // Se tiver 2 preços, o menor costuma ser o preço atual
          price = Math.min(...allPrices);
          if (!originalPrice) {
            originalPrice = Math.max(...allPrices);
          }
        }
      }
    }
  }

  // 4. Porcentagem de desconto (% OFF)
  let discountPct: number | undefined;
  const discMatch = text.match(/(\d{1,2})%\s*(?:off|de\s+desconto)/i);
  if (discMatch && discMatch[1]) {
    discountPct = parseInt(discMatch[1], 10);
  } else if (originalPrice && price && originalPrice > price) {
    discountPct = Math.round((1 - price / originalPrice) * 100);
  }

  // 5. Título
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let title: string | undefined;
  for (const line of lines) {
    // Ignora linha que é link
    if (line.startsWith('http://') || line.startsWith('https://')) continue;
    // Ignora linha curta ou de cabeçalho irrelevante
    if (line.length < 3) continue;
    // Ignora linha que é exclusivamente CTA de link
    if (/^(?:compre\s+aqui|clique\s+aqui|link|acesse|confira|pegu?e\s+aqui)/i.test(line)) continue;
    // Ignora linha que é exclusivamente menção a cupom
    if (/^(?:🎟️|🎫|🏷️)?\s*(?:cupom|c[uú]pom|c[oó]digo|voucher|vale)\s*:/i.test(line)) continue;
    // Ignora linha que é exclusivamente preço
    if (/^(?:(?:❌|✅)?\s*(?:de|por|preço|valor|r\$))\s*:?/i.test(line)) continue;

    // Limpa emojis decorativos do começo
    const cleaned = line
      .replace(/^[\s🔥⚡✨💥🎉🚨⭐📦🛒]+/, '')
      .replace(/[\s🔥⚡✨💥🎉🚨⭐📦🛒]+$/, '')
      .trim();

    if (cleaned.length >= 3) {
      title = cleaned;
      break;
    }
  }

  return {
    title,
    price,
    originalPrice,
    discountPct,
    coupon,
    urls,
  };
}
