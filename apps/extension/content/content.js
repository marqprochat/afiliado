// Content Script para extração rápida e botão flutuante

(function () {
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

      const priceFraction = document.querySelector(
        '.ui-pdp-price__second-line .andes-money-amount__fraction, .ui-pdp-price--size-large .andes-money-amount__fraction',
      );
      const priceCents = document.querySelector(
        '.ui-pdp-price__second-line .andes-money-amount__cents, .ui-pdp-price--size-large .andes-money-amount__cents',
      );
      if (priceFraction) {
        price = parseFloat(
          priceFraction.textContent.replace(/\./g, '') +
            (priceCents ? `.${priceCents.textContent}` : ''),
        );
      }

      const origFraction = document.querySelector(
        '.ui-pdp-price__original-value .andes-money-amount__fraction',
      );
      if (origFraction) {
        originalPrice = parseFloat(origFraction.textContent.replace(/\./g, ''));
      }

      const discountEl = document.querySelector(
        '.ui-pdp-price__second-line .ui-pdp-price__discount',
      );
      if (discountEl) {
        const m = discountEl.textContent.match(/(\d+)%/);
        if (m) discountPct = parseInt(m[1], 10);
      }

      const imgEl =
        document.querySelector('img.ui-pdp-image') ||
        document.querySelector('meta[property="og:image"]');
      if (imgEl) {
        const src =
          imgEl.getAttribute('data-zoom') ||
          imgEl.getAttribute('src') ||
          imgEl.getAttribute('content');
        if (src) images.push(src);
      }

      if (document.querySelector('svg.ui-pdp-icon--full, [class*="full"]')) shipping = 'FULL';
      else if (/frete grátis/i.test(document.body.innerText)) shipping = 'FREE';
    }

    // Amazon
    else if (url.includes('amazon.com.br')) {
      const titleEl = document.querySelector('#productTitle');
      if (titleEl) title = titleEl.textContent.trim();

      const offscreen = document.querySelector(
        '#corePrice_feature_div .a-price .a-offscreen, .a-price.priceToPay .a-offscreen',
      );
      if (offscreen) {
        const cleaned = offscreen.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        price = parseFloat(cleaned);
      }

      const basisOffscreen = document.querySelector(
        '#basisPrice .a-offscreen, .a-price.a-text-price .a-offscreen',
      );
      if (basisOffscreen) {
        const cleaned = basisOffscreen.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        originalPrice = parseFloat(cleaned);
      }

      const imgEl = document.querySelector('#landingImage');
      if (imgEl) {
        const src = imgEl.getAttribute('data-old-hires') || imgEl.getAttribute('src');
        if (src) images.push(src);
      }

      if (document.querySelector('.a-icon-prime, #primeSavingsUpsell')) shipping = 'FREE';
    }

    // Magalu
    else if (url.includes('magazineluiza.com.br') || url.includes('magazinevoce.com.br')) {
      const titleEl =
        document.querySelector('[data-testid="heading-product-title"]') ||
        document.querySelector('h1');
      if (titleEl) title = titleEl.textContent.trim();

      const priceEl = document.querySelector(
        '[data-testid="price-value"], [data-testid="price-default"]',
      );
      if (priceEl) {
        const cleaned = priceEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        price = parseFloat(cleaned);
      }

      const origEl = document.querySelector('[data-testid="price-original"]');
      if (origEl) {
        const cleaned = origEl.textContent.replace(/[^\d,]/g, '').replace(',', '.');
        originalPrice = parseFloat(cleaned);
      }

      const imgEl = document.querySelector(
        '[data-testid="image-selected-thumbnail"], [data-testid="main-image"]',
      );
      if (imgEl) {
        const src = imgEl.getAttribute('src');
        if (src) images.push(src);
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
      const apiUrl = saved.apiUrl || 'http://localhost:3001';
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

      try {
        const res = await fetch(`${apiUrl}/api/v1/extension/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify({
            ...product,
            url,
            marketplaceKind,
          }),
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
