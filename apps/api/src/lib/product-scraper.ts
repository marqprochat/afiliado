export interface ScrapedProductMeta {
  title?: string | undefined;
  price?: number | undefined;
  originalPrice?: number | undefined;
  discountPct?: number | undefined;
  images: string[];
}

export async function scrapeProductMeta(url: string): Promise<ScrapedProductMeta> {
  const images: string[] = [];
  let title: string | undefined;
  let price: number | undefined;
  let originalPrice: number | undefined;
  let discountPct: number | undefined;

  function toAbsUrl(src: string): string | null {
    if (!src || typeof src !== 'string') return null;
    src = src.trim();
    if (!src || src.startsWith('data:')) return null;
    if (src.startsWith('//')) return `https:${src}`;
    if (src.startsWith('http://') || src.startsWith('https://')) return src;
    try {
      return new URL(src, url).href;
    } catch {
      return null;
    }
  }

  function addImage(src: string | null | undefined) {
    if (!src) return;
    const abs = toAbsUrl(src);
    if (abs && abs.startsWith('http') && !images.includes(abs)) {
      images.push(abs);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: controller.signal,
    });
    if (!res.ok) return { images };

    const html = await res.text();

    // 1. Schema.org JSON-LD
    const jsonLdRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const rawJson = match[1]?.trim();
        if (!rawJson || !rawJson.includes('Product')) continue;
        const parsed = JSON.parse(rawJson);
        const candidates = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed['@graph'])
            ? parsed['@graph']
            : [parsed];

        for (const item of candidates) {
          if (!item || typeof item !== 'object') continue;
          const type = item['@type'];
          const isProduct =
            type === 'Product' ||
            type === 'IndividualProduct' ||
            type === 'ProductGroup' ||
            (Array.isArray(type) && type.includes('Product'));

          if (isProduct) {
            if (!title && item.name) title = String(item.name).trim();
            if (!title && item.headline) title = String(item.headline).trim();

            const imgField = item.image;
            if (imgField) {
              if (Array.isArray(imgField)) {
                for (const i of imgField) {
                  if (typeof i === 'string') addImage(i);
                  else if (i && typeof i === 'object') addImage(i.url || i.contentUrl);
                }
              } else if (typeof imgField === 'object') {
                addImage(imgField.url || imgField.contentUrl);
              } else if (typeof imgField === 'string') {
                addImage(imgField);
              }
            }

            const offers = Array.isArray(item.offers) ? item.offers : item.offers ? [item.offers] : [];
            for (const offer of offers) {
              if (!offer) continue;
              if (offer.image) {
                if (typeof offer.image === 'string') addImage(offer.image);
                else if (offer.image.url) addImage(offer.image.url);
              }
              const rawP = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
              if (rawP !== undefined && rawP !== null && price === undefined) {
                const p = parseFloat(String(rawP).replace(',', '.'));
                if (!isNaN(p) && p > 0) price = p;
              }
              const rawHigh = offer.highPrice ?? offer.priceSpecification?.maxPrice;
              if (rawHigh !== undefined && rawHigh !== null && originalPrice === undefined) {
                const hp = parseFloat(String(rawHigh).replace(',', '.'));
                if (!isNaN(hp) && hp > 0) originalPrice = hp;
              }
            }
          }
        }
      } catch {}
    }

    // 2. OpenGraph / Twitter Meta Tags
    const metaTagRegex = /<meta\b[^>]*?(?:property|name)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi;
    const metaMap = new Map<string, string>();
    while ((match = metaTagRegex.exec(html)) !== null) {
      const key = match[1]!.toLowerCase();
      const val = match[2]!;
      if (!metaMap.has(key)) metaMap.set(key, val);
    }
    const metaTagReverseRegex = /<meta\b[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']([^"']+)["'][^>]*>/gi;
    while ((match = metaTagReverseRegex.exec(html)) !== null) {
      const key = match[2]!.toLowerCase();
      const val = match[1]!;
      if (!metaMap.has(key)) metaMap.set(key, val);
    }

    if (images.length === 0) {
      addImage(metaMap.get('og:image:secure_url'));
      addImage(metaMap.get('og:image'));
      addImage(metaMap.get('twitter:image'));
      addImage(metaMap.get('twitter:image:src'));
      addImage(metaMap.get('image'));
    }

    if (!title) {
      title = metaMap.get('og:title') || metaMap.get('twitter:title');
    }

    if (price === undefined) {
      const metaP =
        metaMap.get('product:price:amount') ||
        metaMap.get('og:price:amount') ||
        metaMap.get('twitter:data1');
      if (metaP) {
        const cleaned = metaP.replace(/[^\d.,]/g, '').replace(',', '.');
        const p = parseFloat(cleaned);
        if (!isNaN(p) && p > 0) price = p;
      }
    }

    // 3. Fallback Title via <title> tag
    if (!title) {
      const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].replace(/\s+/g, ' ').trim();
      }
    }

    if (originalPrice && price && originalPrice > price) {
      discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
    }
  } catch {
    // Timeout or network error
  } finally {
    clearTimeout(timeoutId);
  }

  return {
    ...(title ? { title } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(originalPrice !== undefined ? { originalPrice } : {}),
    ...(discountPct !== undefined ? { discountPct } : {}),
    images,
  };
}
