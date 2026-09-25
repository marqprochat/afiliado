// Content Script para extração rápida e botão flutuante

(function () {
  // Helper para extrair valor numérico de um único container de preço (.andes-money-amount)
  function parseAndesMoney(el) {
    if (!el) return null;
    const fracEl = el.querySelector('.andes-money-amount__fraction');
    if (!fracEl) return null;
    const frac = fracEl.textContent.replace(/\./g, '').trim();
    const centsEl = el.querySelector('.andes-money-amount__cents');
    const cents = centsEl ? centsEl.textContent.trim() : null;
    const val = parseFloat(frac + (cents ? `.${cents}` : ''));
    return isNaN(val) ? null : val;
  }

  // Helper para verificar se uma palavra é stopword/termo genérico de cupom
  function isCouponStopword(word) {
    if (!word || typeof word !== 'string') return true;
    const upper = word.trim().toUpperCase();
    if (upper.length < 3 || upper.length > 25) return true;
    if (/^\d+$/.test(upper)) return true;
    const stopwords = window.AFILADOS_COUPON_STOPWORDS;
    if (stopwords && stopwords.has(upper)) return true;
    return false;
  }

  // Extrai código de cupom com escopo restrito a containers promocionais da loja
  function extractCouponFromScope(scope, storeKey) {
    if (!scope) return null;
    const stores = window.AFILADOS_COUPON_STORES || {};
    const store = stores[storeKey];
    const selectors = (store && store.productCouponSelectors) || [
      '[class*="coupon"]',
      '[class*="cupom"]',
      '[class*="voucher"]',
      '[class*="promo"]',
    ];

    // 1. Tenta seletores específicos de cupom/promoção
    for (const sel of selectors) {
      const els = scope.querySelectorAll(sel);
      for (const el of els) {
        const text = el.textContent || '';
        const keywordMatch = text.match(/(?:cupom|c[oó]digo|voucher|promo(?:code)?|claim\s*code)[\s:]+([A-Za-z0-9_\-]{3,20})/i);
        if (keywordMatch && !isCouponStopword(keywordMatch[1])) {
          return keywordMatch[1].toUpperCase();
        }
        const trimmed = text.trim();
        if (/^[A-Za-z0-9_\-]{4,15}$/.test(trimmed) && !isCouponStopword(trimmed)) {
          return trimmed.toUpperCase();
        }
      }
    }

    // 2. Fallback em containers de preço restritos (evita pegar o body inteiro)
    const priceContainer = scope.querySelector(
      '.ui-pdp-price, #corePrice_feature_div, [data-testid*="price"], [class*="price-default"], .product-price',
    );
    if (priceContainer) {
      const match = priceContainer.textContent.match(/(?:cupom|c[oó]digo|voucher)[\s:]+([A-Za-z0-9_\-]{3,20})/i);
      if (match && !isCouponStopword(match[1])) {
        return match[1].toUpperCase();
      }
    }

    return null;
  }

  // Extrai metadados do DOM da página atual
  function extractProductFromPage() {
    const url = window.location.href;
    let title = document.title;
    let price = null;
    let originalPrice = null;
    let discountPct = null;
    let images = [];
    let shipping = 'UNKNOWN';
    let couponCode = null;

    // Mercado Livre
    if (url.includes('mercadolivre.com.br')) {
      const titleEl = document.querySelector('h1.ui-pdp-title') || document.querySelector('h1');
      if (titleEl) title = titleEl.textContent.trim();

      // 1. Preço Original (riscado / "de")
      const origEl = document.querySelector(
        '.ui-pdp-price__original-value, .andes-money-amount--previous, s .andes-money-amount, del .andes-money-amount, .ui-pdp-price__subtitles .andes-money-amount, s, del',
      );
      const parsedOrig = parseAndesMoney(origEl);
      if (parsedOrig) originalPrice = parsedOrig;

      // 2. Preço Atual (com escopo restrito ao elemento que não é o original)
      let currentPriceEl = document.querySelector('.ui-pdp-price__second-line');
      if (!currentPriceEl || !currentPriceEl.querySelector('.andes-money-amount__fraction')) {
        currentPriceEl =
          document.querySelector(
            '.ui-pdp-price__price .andes-money-amount:not(.andes-money-amount--previous), .ui-pdp-price__main-container .andes-money-amount:not(.andes-money-amount--previous):not(s *):not(del *)',
          ) ||
          Array.from(document.querySelectorAll('.andes-money-amount')).find(
            (el) => !el.closest('s, del, .ui-pdp-price__original-value, .andes-money-amount--previous'),
          );
      }

      const parsedPrice = parseAndesMoney(currentPriceEl);
      if (parsedPrice) {
        price = parsedPrice;
      } else {
        // Fallback meta tags de preço
        const metaPrice =
          document.querySelector('meta[itemprop="price"]')?.getAttribute('content') ||
          document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content');
        if (metaPrice) {
          const p = parseFloat(metaPrice);
          if (!isNaN(p) && p > 0) price = p;
        }
      }

      // Se o original for menor ou igual ao preço atual, anula o original
      if (originalPrice && price && originalPrice <= price) {
        originalPrice = null;
      }

      // 3. Desconto %
      const discountEl = document.querySelector(
        '.ui-pdp-price__second-line .ui-pdp-price__discount, .ui-pdp-discount, .ui-pdp-price__discount',
      );
      if (discountEl) {
        const m = discountEl.textContent.match(/(\d+)%/);
        if (m) discountPct = parseInt(m[1], 10);
      }
      if (!discountPct && originalPrice && price && originalPrice > price) {
        discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
      }

      // 4. Imagens
      // A galeria do ML repete a mesma foto em dois elementos: a miniatura da tira lateral
      // (`src` em baixa resolução) e a imagem grande em exibição (`data-zoom`, alta resolução).
      // Como ambos batem no seletor abaixo, priorizamos exclusivamente `data-zoom` quando existir
      // pelo menos um — senão a miniatura de baixa resolução acaba entrando como images[0].
      const imgElements = document.querySelectorAll(
        'img.ui-pdp-image, .ui-pdp-gallery__figure img, [data-zoom]',
      );
      const zoomImages = [];
      const srcImages = [];
      imgElements.forEach((img) => {
        const zoom = img.getAttribute('data-zoom');
        if (zoom && zoom.startsWith('http')) {
          if (!zoomImages.includes(zoom)) zoomImages.push(zoom);
          return;
        }
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src && src.startsWith('http') && !srcImages.includes(src)) {
          srcImages.push(src);
        }
      });
      images = zoomImages.length > 0 ? zoomImages : srcImages;
      if (images.length === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        if (ogImage && ogImage.startsWith('http')) images.push(ogImage);
      }

      // 5. Frete e FULL
      if (document.querySelector('svg.ui-pdp-icon--full, [class*="ui-pdp-icon--full"], [class*="full"]')) {
        shipping = 'FULL';
      } else if (/frete grátis/i.test(document.body.innerText)) {
        shipping = 'FREE';
      }

      // 6. Cupom
      couponCode = extractCouponFromScope(document, 'MERCADOLIVRE');
    }

    // Amazon
    else if (url.includes('amazon.com.br')) {
      const titleEl = document.querySelector('#productTitle') || document.querySelector('#title');
      if (titleEl) title = titleEl.textContent.trim();

      const offscreen = document.querySelector(
        '#corePrice_feature_div .a-price .a-offscreen, #apexPriceToPay .a-price .a-offscreen, .a-price.priceToPay .a-offscreen, #priceblock_ourprice',
      );
      if (offscreen) {
        const cleaned = offscreen.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) price = parsed;
      }

      const basisOffscreen = document.querySelector(
        '#basisPrice .a-offscreen, .a-price.a-text-price .a-offscreen, #listPrice .a-offscreen',
      );
      if (basisOffscreen) {
        const cleaned = basisOffscreen.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) originalPrice = parsed;
      }

      const discountEl = document.querySelector('.savingPriceOverride, .reinventPriceSavingsPercentageMargin');
      if (discountEl) {
        const m = discountEl.textContent.match(/(\d+)%/);
        if (m) discountPct = parseInt(m[1], 10);
      }
      if (!discountPct && originalPrice && price && originalPrice > price) {
        discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
      }

      // `data-old-hires`/`data-a-dynamic-image` são preferidos por serem mais estáveis,
      // mas o `src` puro também é uma imagem válida da Amazon (mesmo quando o caminho
      // contém "MEASUREMENT" — é só o nome do bucket de teste A/B da Amazon, não indica
      // formato quebrado) e não deve ser descartado.
      const imgEl = document.querySelector('#landingImage, #imgBlkFront');
      if (imgEl) {
        let src = imgEl.getAttribute('data-old-hires');
        if (!src) {
          const dynamic = imgEl.getAttribute('data-a-dynamic-image');
          if (dynamic) {
            try {
              const parsed = JSON.parse(dynamic);
              const keys = Object.keys(parsed);
              if (keys.length > 0 && keys[0].startsWith('http')) src = keys[0];
            } catch {}
          }
        }
        if (!src) src = imgEl.getAttribute('src');
        if (src && src.startsWith('http')) images.push(src);
      }
      if (images.length === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        if (ogImage && ogImage.startsWith('http')) images.push(ogImage);
      }

      if (document.querySelector('.a-icon-prime, #primeSavingsUpsell')) shipping = 'FREE';
      else if (/frete grátis/i.test(document.body.innerText)) shipping = 'FREE';

      // 6. Cupom Amazon (sem valor genérico fixo)
      couponCode = extractCouponFromScope(document, 'AMAZON');
    }

    // Magalu
    else if (url.includes('magazineluiza.com.br') || url.includes('magazinevoce.com.br')) {
      const titleEl =
        document.querySelector('[data-testid="heading-product-title"]') ||
        document.querySelector('h1.header-product__title') ||
        document.querySelector('h1');
      if (titleEl) title = titleEl.textContent.trim();

      const priceEl = document.querySelector(
        '[data-testid="price-value"], [data-testid="price-default"], .price-template__text, [data-testid="price-best"]',
      );
      if (priceEl) {
        const cleaned = priceEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) price = parsed;
      }

      const origEl = document.querySelector(
        '[data-testid="price-original"], [data-testid="price-from"], .price-template__from',
      );
      if (origEl) {
        const cleaned = origEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) originalPrice = parsed;
      }

      const discountEl = document.querySelector('[data-testid="price-discount"], .discount-tag');
      if (discountEl) {
        const m = discountEl.textContent.match(/(\d+)%/);
        if (m) discountPct = parseInt(m[1], 10);
      }
      if (!discountPct && originalPrice && price && originalPrice > price) {
        discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
      }

      const imgEl = document.querySelector(
        '[data-testid="image-selected-thumbnail"], [data-testid="main-image"], img.image-gallery-image',
      );
      if (imgEl) {
        const src = imgEl.getAttribute('src');
        if (src && src.startsWith('http')) images.push(src);
      }
      if (images.length === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        if (ogImage && ogImage.startsWith('http')) images.push(ogImage);
      }

      if (/frete grátis|retira rápido|retira grátis/i.test(document.body.innerText)) shipping = 'FREE';

      // 6. Cupom Magalu
      couponCode = extractCouponFromScope(document, 'MAGALU');
    }

    // Shopee
    else if (url.includes('shopee.com.br')) {
      const titleEl = document.querySelector('.WBAln7, .V37x3t, h1, [class*="product-title"]');
      if (titleEl) title = titleEl.textContent.trim();

      const priceEl = document.querySelector('.G27fpf, .pqTWkA, [class*="product-price"]');
      if (priceEl) {
        const cleaned = priceEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) price = parsed;
      }

      const origEl = document.querySelector('.k25aG1, .NZkL9r, [class*="original-price"]');
      if (origEl) {
        const cleaned = origEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) originalPrice = parsed;
      }

      const imgEl = document.querySelector('img._11-H3t, img.pointer, [class*="product-image"] img');
      if (imgEl) {
        const src = imgEl.getAttribute('src');
        if (src && src.startsWith('http')) images.push(src);
      }

      if (/frete grátis/i.test(document.body.innerText)) shipping = 'FREE';

      // 6. Cupom Shopee
      couponCode = extractCouponFromScope(document, 'SHOPEE');
    }

    // AliExpress
    // Classes CSS-módulo com sufixo hash (ex.: "price-default--current--F8OlYIo") — a Aliexpress
    // troca o hash a cada build, então usamos seletor por prefixo ([class*=...]) para resistir a
    // isso. Não existe h1 de produto de verdade (o único <h1> da página é fixo "Aliexpress"), o
    // título real fica em [class*="title--wrap"] (com fallback pro meta og:title).
    else if (url.includes('aliexpress.com')) {
      // 1. Em páginas SSR / Bundle Deals ou listagens, ao clicar num produto o AliExpress abre
      // um modal (.comet-v2-modal-wrap) apensado ao final do DOM. Se houver modais, o ativo é o
      // último visível na pilha do DOM.
      const allModals = Array.from(
        document.querySelectorAll(
          '.comet-v2-modal-wrap, .cosmos-drawer-wrap, [class*="modal-wrap"], [class*="drawer-wrap"], [class*="pdp-mini-wrap"], [class*="mini--wrap"]',
        ),
      ).filter((m) => {
        const style = window.getComputedStyle(m);
        const rect = m.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 100 &&
          rect.height > 100 &&
          m.querySelector('[class*="title--wrap"], [class*="price-default--current"]')
        );
      });

      const activeModal = allModals.length > 0 ? allModals[allModals.length - 1] : null;
      const scope = activeModal || document;

      const titleEl = scope.querySelector('[class*="title--wrap"]');
      if (titleEl) {
        title = titleEl.textContent.trim();
      } else if (!activeModal) {
        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        if (ogTitle) title = ogTitle.replace(/\s*-\s*AliExpress.*$/i, '').trim();
      }

      const priceEl = scope.querySelector('[class*="price-default--current"]');
      if (priceEl) {
        const cleaned = priceEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) price = parsed;
      }

      const origEl = scope.querySelector('[class*="price-default--original"]');
      if (origEl) {
        const cleaned = origEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) originalPrice = parsed;
      }

      const discountEl = scope.querySelector('[class*="price-default--discount"]');
      if (discountEl) {
        const m = discountEl.textContent.match(/(\d+)%/);
        if (m) discountPct = parseInt(m[1], 10);
      }
      if (!discountPct && originalPrice && price && originalPrice > price) {
        discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
      }

      // 2. Extração de imagem do produto ativo no escopo
      // Prioridade 1: Galeria ativa do escopo (magnifier, slider ativo, preview da esquerda)
      const galleryImg = scope.querySelector(
        '[class*="magnifier--image"], [class*="slider--active"] img, [class*="slider--img"] img, [class*="image-view"] img, [class*="gallery"] img, [class*="pdp-mini-info-left"] img, [class*="pdp-info-left"] img, [class*="main-image"] img',
      );
      if (galleryImg) {
        let src = galleryImg.getAttribute('src') || galleryImg.getAttribute('data-src') || galleryImg.src;
        if (src) {
          if (src.startsWith('//')) src = `https:${src}`;
          if (
            src.startsWith('http') &&
            !src.includes('evaluate') &&
            !src.includes('avatar') &&
            !src.includes('stars')
          ) {
            images.push(src);
          }
        }
      }

      // Prioridade 2: Foto da variação de SKU selecionada no modal/página
      if (images.length === 0) {
        const skuImg = scope.querySelector(
          '[class*="sku-item--selected"] img, [class*="sku--selected"] img, [class*="skuItem--selected"] img',
        );
        if (skuImg) {
          let src = skuImg.getAttribute('src') || skuImg.getAttribute('data-src') || skuImg.src;
          if (src) {
            if (src.startsWith('//')) src = `https:${src}`;
            if (src.startsWith('http')) images.push(src);
          }
        }
      }

      // Prioridade 3: Meta tag og:image (apenas se não for modal e se não for ícone genérico)
      if (images.length === 0 && !activeModal) {
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        const isGenericOgImage =
          ogImage &&
          (ogImage.includes('HTB18eCBQXXXXXXfXXXX760XFXXXa') ||
            ogImage.includes('logo') ||
            ogImage.includes('icon'));
        if (ogImage && ogImage.startsWith('http') && !isGenericOgImage) {
          images.push(ogImage);
        }
      }

      // Prioridade 4: Seletor de card no escopo (para páginas estáticas de bundle)
      if (images.length === 0) {
        const cardImg = scope.querySelector(
          'img.AIC-MI-img, [class*="AIC-MI-container"] img, [class*="productContainer"] img, [class*="productSliderList"] img, [class*="product-img"] img, [class*="product-image"] img, [class*="detail-gallery"] img, [class*="item-image"] img',
        );
        if (cardImg) {
          let src = cardImg.getAttribute('src') || cardImg.getAttribute('data-src') || cardImg.src;
          if (src) {
            if (src.startsWith('//')) src = `https:${src}`;
            if (src.startsWith('http')) images.push(src);
          }
        }
      }

      if (/frete gr[aá]tis/i.test(document.body.innerText)) shipping = 'FREE';

      // 6. Cupom AliExpress
      couponCode = extractCouponFromScope(scope, 'ALIEXPRESS');
    }

    return {
      title,
      price,
      originalPrice,
      discountPct,
      images,
      shipping,
      couponCode,
    };
  }

  // Reconhece URLs de produto nos 4 marketplaces suportados (mesmos padrões de
  // packages/core/src/urls.ts#parseProductUrl, duplicados aqui porque a extensão
  // roda como content script puro, sem acesso ao pacote TS do monorepo).
  function isProductUrl(raw) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return false;
    }
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname;
    if (host === 'shopee.com.br') {
      return /-i\.(\d+)\.(\d+)/.test(path) || /^\/product\/(\d+)\/(\d+)/.test(path);
    }
    if (host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br')) {
      return /MLB-?(\d+)/i.test(path) || /\/p\/(MLB\d+|[A-Z0-9]+)/i.test(path);
    }
    if (host === 'amazon.com.br') {
      return /\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/.test(path);
    }
    if (
      host === 'magazineluiza.com.br' ||
      host === 'magazinevoce.com.br' ||
      host.endsWith('.magazinevoce.com.br')
    ) {
      return /\/p\/([a-z0-9]+)/i.test(path) || /\/([a-z0-9]{7,12})\//i.test(path);
    }
    if (host === 'aliexpress.com' || host.endsWith('.aliexpress.com')) {
      return /\/item\/(\d+)/i.test(path) || /_p(\d+)/i.test(path);
    }
    return false;
  }

  // Helper para extrair imagem de um container/card de produto em listagens de busca,
  // com suporte a lazy-load (data-src, data-original, data-lazy-src, data-zoom, srcset etc.)
  // e descarte de placeholders vazios / pixels data:.
  function extractCardImage(container) {
    if (!container) return null;
    const imgEls = Array.from(container.querySelectorAll('img'));
    for (const img of imgEls) {
      const candidates = [
        img.getAttribute('src'),
        img.getAttribute('data-src'),
        img.getAttribute('data-original'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-old-hires'),
        img.getAttribute('data-zoom'),
        img.currentSrc,
        img.src,
      ];

      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (srcset) {
        const firstSrc = srcset.split(',')[0].trim().split(/\s+/)[0];
        if (firstSrc) candidates.push(firstSrc);
      }

      for (let url of candidates) {
        if (!url || typeof url !== 'string') continue;
        url = url.trim();
        if (url.startsWith('data:') || url.startsWith('blob:')) continue;
        if (url.startsWith('//')) url = `https:${url}`;
        if (url.startsWith('http://') || url.startsWith('https://')) {
          if (url.includes('evaluate') || url.includes('avatar') || url.includes('stars')) continue;
          return url;
        }
      }
    }
    return null;
  }

  // Varre todos os links da página atual e devolve, para cada URL de produto única, também
  // título/preço/imagem lidos do próprio card na página — funciona tanto numa página de
  // busca/listagem (dezenas de cards) quanto numa página de produto único (0 ou 1 link).
  // Extrair esses metadados aqui evita depender de o backend raspar cada URL depois (o que
  // para Mercado Livre/Magalu esbarra em bloqueio anti-bot e não retorna dados reais).
  function extractProductsFromPage() {
    const seen = new Set();
    const items = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      if (items.length >= 200) return;
      let absolute;
      try {
        absolute = new URL(a.getAttribute('href'), window.location.href).toString();
      } catch {
        return;
      }
      if (!isProductUrl(absolute)) return;
      // Dedup pela URL sem querystring: variações de cor/tamanho do mesmo produto
      // geram links com o mesmo path mas parâmetros diferentes (ex: pdp_filters=deal:MLBxxxx-1
      // no Mercado Livre, um por cor), e são o mesmo produto.
      let dedupeKey;
      try {
        const du = new URL(absolute);
        dedupeKey = du.origin + du.pathname;
      } catch {
        dedupeKey = absolute;
      }
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      // Sobe a partir do link até achar um container de card razoável: o primeiro
      // ancestral que já contém uma imagem e um valor em R$ (até 6 níveis acima).
      // Para não vazar preço/imagem de um card vizinho, a subida é interrompida assim
      // que o próximo ancestral passaria a conter mais de um link de produto — sinal
      // de que já saímos do card individual e entramos num wrapper de grade/listagem.
      let container = a;
      for (let i = 0; i < 6 && container.parentElement; i++) {
        const next = container.parentElement;
        const productLinksInNext = Array.from(next.querySelectorAll('a[href]')).filter((el) => {
          try {
            return isProductUrl(new URL(el.getAttribute('href'), window.location.href).toString());
          } catch {
            return false;
          }
        });
        if (productLinksInNext.length > 1) break;
        container = next;
        if (container.querySelector('img') && /R\$\s?[\d.,]+/.test(container.textContent || '')) {
          break;
        }
      }

      const priceMatches = Array.from((container.textContent || '').matchAll(/R\$\s?([\d.,]+)/g))
        .map((m) => parseFloat(m[1].replace(/\./g, '').replace(',', '.')))
        .filter((n) => !isNaN(n) && n > 0);
      let price;
      let originalPrice;
      if (priceMatches.length === 1) {
        price = priceMatches[0];
      } else if (priceMatches.length > 1) {
        price = Math.min(...priceMatches);
        const maxV = Math.max(...priceMatches);
        if (maxV > price) originalPrice = maxV;
      }

      const image = extractCardImage(container);

      const primaryImg = container.querySelector('img');
      let title =
        a.getAttribute('title') ||
        a.getAttribute('aria-label') ||
        primaryImg?.getAttribute('alt') ||
        (a.textContent || '').trim();
      if (title) title = title.replace(/R\$\s?[\d.,]+/g, '').trim().slice(0, 200) || undefined;

      items.push({
        url: absolute,
        ...(title ? { title } : {}),
        ...(price !== undefined ? { price } : {}),
        ...(originalPrice !== undefined ? { originalPrice } : {}),
        ...(image ? { images: [image] } : {}),
      });
    });
    return items;
  }

  // Botão flutuante para copiar todos os produtos da página atual (ex: uma página de busca
  // do Mercado Livre/Amazon/Magalu), com título/preço/imagem já lidos do card, para colar em
  // Buscar Produtos → Por Links/CSV no app — útil quando a busca automática do marketplace
  // não está disponível (bloqueio anti-bot, API sem acesso etc.).
  function injectCopyLinksButton() {
    if (document.getElementById('afilados-copy-links-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'afilados-copy-links-btn';
    btn.className = 'afilados-float-btn afilados-float-btn--secondary';
    btn.innerHTML = '<span>🔗</span> Copiar links';
    btn.title = 'Copiar todos os produtos desta página para colar no Afilados';

    btn.addEventListener('click', async () => {
      const items = extractProductsFromPage();
      if (items.length === 0) {
        btn.innerHTML = '<span>—</span> Nenhum link';
        setTimeout(() => {
          btn.innerHTML = '<span>🔗</span> Copiar links';
        }, 2500);
        return;
      }
      try {
        await navigator.clipboard.writeText(JSON.stringify(items));
        btn.innerHTML = `<span>✓</span> ${items.length} produto(s) copiado(s)!`;
        btn.classList.add('success');
      } catch {
        btn.innerHTML = '<span>❌</span> Falha ao copiar';
      }
      setTimeout(() => {
        btn.innerHTML = '<span>🔗</span> Copiar links';
        btn.classList.remove('success');
      }, 3000);
    });

    document.body.appendChild(btn);
  }

  // Responde a mensagens da extensão
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.action === 'GET_PRODUCT_DATA') {
        const product = extractProductFromPage();
        sendResponse({ product });
      }
    });
  }

  // Injeta botão flutuante na página
  function injectFloatingButton() {
    if (document.getElementById('afilados-floating-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'afilados-floating-btn';
    btn.className = 'afilados-float-btn';
    btn.innerHTML = '<span>⚡</span> Afilados';
    btn.title = 'Capturar oferta para o Afilados';

    btn.addEventListener('click', async () => {
      btn.innerHTML = '<span>⏳</span> Enviando...';
      btn.classList.add('loading');

      const saved = await chrome.storage.local.get(['apiUrl', 'apiToken']);
      const apiUrl = (saved.apiUrl || 'http://localhost:3011').replace(/\/+$/, '');
      const apiToken = saved.apiToken;

      if (!apiToken) {
        alert('Afilados Connect: Configure seu Token de API abrindo o popup da extensão.');
        btn.innerHTML = '<span>⚡</span> Afilados';
        btn.classList.remove('loading');
        return;
      }

      const product = extractProductFromPage();
      const url = window.location.href;
      let marketplaceKind = 'SHOPEE';
      if (url.includes('mercadolivre.com.br')) marketplaceKind = 'MERCADOLIVRE';
      else if (url.includes('amazon.com.br')) marketplaceKind = 'AMAZON';
      else if (url.includes('magazineluiza.com.br') || url.includes('magazinevoce.com.br'))
        marketplaceKind = 'MAGALU';
      else if (url.includes('aliexpress.com')) marketplaceKind = 'ALIEXPRESS';

      const payload = {
        url,
        marketplaceKind,
        ...(product.title ? { title: product.title } : {}),
        ...(product.price !== null && product.price !== undefined ? { price: product.price } : {}),
        ...(product.originalPrice ? { originalPrice: product.originalPrice } : {}),
        ...(product.discountPct ? { discountPct: product.discountPct } : {}),
        ...(product.images && product.images.length > 0 ? { images: product.images } : {}),
        ...(product.shipping && product.shipping !== 'UNKNOWN' ? { shipping: product.shipping } : {}),
        ...(product.couponCode ? { couponCode: product.couponCode } : {}),
      };

      try {
        const res = await fetch(`${apiUrl}/api/v1/extension/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          btn.innerHTML = '<span>✓</span> Capturado!';
          btn.classList.add('success');
          // Envia o cupom explicitamente para a Central de Cupons se detectado
          if (product.couponCode) {
            fetch(`${apiUrl}/api/v1/extension/coupons`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiToken}`,
              },
              body: JSON.stringify({
                code: product.couponCode,
                store: marketplaceKind,
                source: 'EXTENSION',
              }),
            }).catch(() => {});
          }
          setTimeout(() => {
            btn.innerHTML = '<span>⚡</span> Afilados';
            btn.classList.remove('loading', 'success');
          }, 3000);
        } else {
          btn.innerHTML = '<span>❌</span> Erro';
          setTimeout(() => {
            btn.innerHTML = '<span>⚡</span> Afilados';
            btn.classList.remove('loading');
          }, 2500);
        }
      } catch {
        btn.innerHTML = '<span>❌</span> Offline';
        setTimeout(() => {
          btn.innerHTML = '<span>⚡</span> Afilados';
          btn.classList.remove('loading');
        }, 2500);
      }
    });

    document.body.appendChild(btn);
  }

  // --- Painel Flutuante de Cupons no Carrinho / Checkout ---

  function detectCartStore() {
    const currentUrl = window.location.href;
    const stores = window.AFILADOS_COUPON_STORES || {};
    for (const key of Object.keys(stores)) {
      const s = stores[key];
      if (s.cartMatch && s.cartMatch.test(currentUrl)) {
        return { key, ...s };
      }
    }
    return null;
  }

  function renderCartCouponPanel(coupons, store, apiUrl, apiToken) {
    if (document.getElementById('afilados-cart-coupons-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'afilados-cart-coupons-panel';

    const header = document.createElement('div');
    header.id = 'afilados-cart-coupons-header';
    header.innerHTML = `
      <h4>
        <span>🎟️ Cupons Afilados</span>
        <span class="afilados-cart-badge-count">${coupons.length}</span>
      </h4>
      <button class="afilados-cart-toggle-btn" title="Minimizar / Expandir">—</button>
    `;

    const body = document.createElement('div');
    body.id = 'afilados-cart-coupons-body';

    coupons.forEach((coupon) => {
      const card = document.createElement('div');
      card.className = 'afilados-cart-coupon-card';
      card.dataset.couponId = coupon.id;

      let statusClass = 'afilados-status--unverified';
      let statusLabel = 'Não verificado';
      if (coupon.status === 'VALID') {
        statusClass = 'afilados-status--valid';
        statusLabel = 'Válido';
      } else if (coupon.status === 'INVALID') {
        statusClass = 'afilados-status--invalid';
        statusLabel = 'Inválido';
      }

      let discountText = coupon.description || '';
      if (coupon.discountValue) {
        const valStr =
          coupon.discountType === 'PERCENTAGE'
            ? `${coupon.discountValue}% OFF`
            : `R$ ${coupon.discountValue} OFF`;
        discountText = discountText ? `${valStr} - ${discountText}` : valStr;
      }

      const metaParts = [];
      if (coupon.minSpend) metaParts.push(`Mín: R$ ${coupon.minSpend}`);
      if (coupon.validUntil) {
        try {
          metaParts.push(`Até ${new Date(coupon.validUntil).toLocaleDateString('pt-BR')}`);
        } catch {}
      }

      card.innerHTML = `
        <div class="afilados-cart-coupon-top">
          <span class="afilados-cart-code-tag">${coupon.code}</span>
          <span class="afilados-cart-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        ${discountText ? `<div class="afilados-cart-coupon-desc">${discountText}</div>` : ''}
        ${metaParts.length > 0 ? `<div class="afilados-cart-coupon-meta">${metaParts.join(' • ')}</div>` : ''}
        <div class="afilados-cart-actions">
          <button class="afilados-btn-copy" type="button">
            <span>📋</span> Copiar e destacar campo
          </button>
          <div class="afilados-feedback-box" style="display: none;">
            <span>Funcionou?</span>
            <div class="afilados-feedback-actions">
              <button class="afilados-btn-feedback success" type="button">👍 Sim</button>
              <button class="afilados-btn-feedback fail" type="button">👎 Não</button>
            </div>
          </div>
        </div>
      `;

      const btnCopy = card.querySelector('.afilados-btn-copy');
      const feedbackBox = card.querySelector('.afilados-feedback-box');
      const btnSuccess = card.querySelector('.afilados-btn-feedback.success');
      const btnFail = card.querySelector('.afilados-btn-feedback.fail');

      btnCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(coupon.code);
          btnCopy.innerHTML = '<span>✓</span> Código copiado!';
          btnCopy.classList.add('copied');
        } catch {
          btnCopy.innerHTML = '<span>✓</span> ' + coupon.code;
        }

        // Destaca o input de cupom no carrinho
        if (store && store.input) {
          try {
            const inputEl = document.querySelector(store.input);
            if (inputEl) {
              inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              inputEl.classList.add('afilados-input-highlight');
              inputEl.focus();
              setTimeout(() => {
                inputEl.classList.remove('afilados-input-highlight');
              }, 6000);
            }
          } catch {}
        }

        // Exibe opções de feedback de validação
        feedbackBox.style.display = 'flex';
      });

      const sendVerification = async (result) => {
        btnSuccess.disabled = true;
        btnFail.disabled = true;
        try {
          await fetch(`${apiUrl}/api/v1/extension/coupons/${coupon.id}/verification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify({
              result,
              metadata: {
                source: 'EXTENSION',
                appliedUrl: window.location.href,
              },
            }),
          });
          feedbackBox.innerHTML = `<span class="afilados-feedback-done">✓ Feedback registrado!</span>`;
        } catch {
          feedbackBox.innerHTML = `<span class="afilados-feedback-done">✓ Registrado localmente</span>`;
        }
      };

      btnSuccess.addEventListener('click', () => sendVerification('SUCCESS'));
      btnFail.addEventListener('click', () => sendVerification('FAILURE'));

      body.appendChild(card);
    });

    // Toggle minimizar
    const toggleBtn = header.querySelector('.afilados-cart-toggle-btn');
    const toggleCollapse = () => {
      panel.classList.toggle('collapsed');
      const isCollapsed = panel.classList.contains('collapsed');
      toggleBtn.textContent = isCollapsed ? '+' : '—';
      body.style.display = isCollapsed ? 'none' : 'flex';
    };
    header.addEventListener('click', toggleCollapse);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
  }

  async function initCartCouponPanel() {
    const store = detectCartStore();
    if (!store) return;
    if (document.getElementById('afilados-cart-coupons-panel')) return;

    if (typeof chrome === 'undefined' || !chrome.storage) return;

    try {
      const saved = await chrome.storage.local.get(['apiUrl', 'apiToken']);
      const apiUrl = (saved.apiUrl || 'http://localhost:3011').replace(/\/+$/, '');
      const apiToken = saved.apiToken;
      if (!apiToken) return;

      const res = await fetch(`${apiUrl}/api/v1/extension/coupons?store=${store.key}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) return;
      const coupons = await res.json();
      if (Array.isArray(coupons) && coupons.length > 0) {
        renderCartCouponPanel(coupons, store, apiUrl, apiToken);
      }
    } catch {}
  }

  // Injeta após carregar a página
  function injectButtons() {
    injectFloatingButton();
    injectCopyLinksButton();
    void initCartCouponPanel();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectButtons();
  } else {
    window.addEventListener('DOMContentLoaded', injectButtons);
  }
})();

