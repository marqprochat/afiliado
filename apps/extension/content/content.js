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
      const couponMatch = document.body.innerText.match(/cupom[:\s]+([A-Z0-9_\-]{4,20})/i);
      if (couponMatch) {
        couponCode = couponMatch[1].toUpperCase();
      }
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

      // `src` às vezes é uma URL interna de medição/AB-test da Amazon
      // (.../images/W/BW_MEDIAX_..._MEASUREMENT_.../images/I/...jpg), não a foto do produto —
      // por isso `data-old-hires`/`data-a-dynamic-image` vêm antes e `src` só é o último recurso.
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
        if (src && src.startsWith('http') && !/MEASUREMENT/i.test(src)) images.push(src);
      }
      if (images.length === 0) {
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        if (ogImage && ogImage.startsWith('http')) images.push(ogImage);
      }

      if (document.querySelector('.a-icon-prime, #primeSavingsUpsell')) shipping = 'FREE';
      else if (/frete grátis/i.test(document.body.innerText)) shipping = 'FREE';

      const couponText = document.querySelector('#couponText, .couponBadge')?.textContent?.trim();
      if (couponText) {
        couponCode = 'CUPOM AMAZON';
      }
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
        if (src) images.push(src);
      }

      if (/frete grátis|retira rápido|retira grátis/i.test(document.body.innerText)) shipping = 'FREE';
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

  // Injeta após carregar a página
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectFloatingButton();
  } else {
    window.addEventListener('DOMContentLoaded', injectFloatingButton);
  }
})();
