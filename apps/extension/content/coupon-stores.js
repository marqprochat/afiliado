// Configurações e seletores de lojas para o painel e captura de cupons na extensão Afilados Connect

(function () {
  const COUPON_STOPWORDS = new Set([
    'FRETE',
    'GRATIS',
    'PARCELADO',
    'PARCELAS',
    'BOLETO',
    'PIX',
    'CARTAO',
    'DESCONTO',
    'DESCONTAO',
    'OFERTA',
    'OFERTAS',
    'PROMO',
    'PROMOCAO',
    'PROMOCOES',
    'CUPOM',
    'CUPONS',
    'VOUCHER',
    'VOUCHERS',
    'APP',
    'NOVO',
    'CLIENTE',
    'PRIMEIRA',
    'COMPRA',
    'BLACK',
    'FRIDAY',
    'AMAZON',
    'MERCADOLIVRE',
    'MAGALU',
    'SHOPEE',
    'ALIEXPRESS',
    'TODOS',
    'PRODUTOS',
    'SELECIONADOS',
    'CONFIRA',
    'APROVEITE',
    'LINK',
    'CLIQUE',
    'AQUI',
  ]);

  const AFILADOS_COUPON_STORES = {
    MERCADOLIVRE: {
      key: 'MERCADOLIVRE',
      name: 'Mercado Livre',
      // Carrinho e Checkout no Mercado Livre
      cartMatch: /^https?:\/\/(www\.)?(mercadolivre\.com\.br|meli\.la)\/(gz\/cart|checkout|carrinho|compra|cart)/i,
      // Seletores na página de produto para capturar cupons
      productCouponSelectors: [
        '.ui-pdp-promotions',
        '.ui-pdp-container__row--coupon',
        '.ui-pdp-price__subtitles',
        '[class*="coupon-wrapper"]',
        '[class*="ui-pdp-coupon"]',
        '[class*="coupon-badge"]',
        '[class*="promotion-tag"]',
      ],
      // Input e botão de aplicar cupom no carrinho/checkout
      input: 'input[name="coupon"], input#coupon_code, input[data-testid="coupon-input"], input[aria-label*="cupom" i], input[placeholder*="cupom" i], .coupon-input input',
      apply: 'button[data-testid="apply-coupon-btn"], button[type="submit"][class*="coupon"], button[aria-label*="aplicar" i], .coupon-input button, button:has(span:contains("Aplicar"))',
      success: [
        '.coupon-applied',
        '[data-testid="coupon-success"]',
        '.ui-pdp-color--GREEN',
        '[class*="coupon-success"]',
        '[class*="discount-applied"]',
      ],
      error: [
        '.coupon-error',
        '[data-testid="coupon-error"]',
        '[class*="coupon-error"]',
        '.ui-pdp-color--RED',
      ],
      autoApply: false,
    },

    AMAZON: {
      key: 'AMAZON',
      name: 'Amazon',
      // Carrinho e Checkout na Amazon Brasil
      cartMatch: /^https?:\/\/(www\.)?amazon\.com\.br\/(gp\/cart\/view\.html|cart|gp\/buy\/spc\/handlers\/display\.html|checkout|gp\/buy\/payselect\/handlers\/display\.html)/i,
      // Seletores de cupom na página de produto
      productCouponSelectors: [
        '#couponText',
        '.couponBadge',
        '#vpcButton',
        '[data-testid="coupon-text"]',
        '.promoPriceBlockMessage',
      ],
      input: 'input[name="claimCode"], input#spc-gcpromoinput, input[placeholder*="código" i], input[placeholder*="cupom" i], input[name="ppw-claimCode"]',
      apply: 'input[name="apply-claim-code"], button[name="apply-claim-code"], input[name="ppw-claimCodeApplyPressed"], .a-button-inner:has(input[name*="claimCode"])',
      success: [
        '.a-alert-success',
        '#pmts-claim-code-success-alert',
        '[data-testid="coupon-success"]',
      ],
      error: [
        '.a-alert-error',
        '#pmts-claim-code-error-alert',
        '[data-testid="coupon-error"]',
      ],
      autoApply: false,
    },

    MAGALU: {
      key: 'MAGALU',
      name: 'Magalu',
      // Carrinho e Checkout na Magazine Luiza
      cartMatch: /^https?:\/\/(www\.)?(magazineluiza\.com\.br|magazinevoce\.com\.br)\/(sacola|carrinho|checkout)/i,
      productCouponSelectors: [
        '[data-testid="coupon-tag"]',
        '[data-testid="price-coupon"]',
        '[class*="coupon"]',
        '[class*="cupom"]',
      ],
      input: 'input#coupon, input[name="coupon"], input[data-testid="coupon-input"], input[placeholder*="cupom" i]',
      apply: 'button[data-testid="apply-coupon-button"], button[data-testid="coupon-submit"], button:has(span:contains("Aplicar"))',
      success: [
        '[data-testid="coupon-success"]',
        '[class*="coupon-applied"]',
        '[class*="feedback-success"]',
      ],
      error: [
        '[data-testid="coupon-error"]',
        '[class*="coupon-error"]',
        '[class*="feedback-error"]',
      ],
      autoApply: false,
    },

    SHOPEE: {
      key: 'SHOPEE',
      name: 'Shopee',
      cartMatch: /^https?:\/\/(www\.)?shopee\.com\.br\/(cart|checkout)/i,
      productCouponSelectors: [
        '[class*="voucher-ticket"]',
        '[class*="product-voucher"]',
        '[class*="voucher"]',
      ],
      input: 'input[placeholder*="código" i], input[placeholder*="cupom" i], input.shopee-searchbar-input__input',
      apply: 'button:has(span:contains("Aplicar")), button.shopee-button-solid--primary',
      success: ['[class*="voucher-applied"]', '[class*="success-message"]'],
      error: ['[class*="voucher-error"]', '[class*="error-message"]'],
      autoApply: false,
    },

    ALIEXPRESS: {
      key: 'ALIEXPRESS',
      name: 'AliExpress',
      cartMatch: /^https?:\/\/([a-z0-9-]+\.)?aliexpress\.com\/(shopcart|p\/order\/confirm\.html|order\/confirm|cart)/i,
      productCouponSelectors: [
        '[class*="coupon--"]',
        '[class*="promo--"]',
        '[class*="code-banner"]',
        '[class*="pdp-mini-info-coupon"]',
      ],
      input: 'input[placeholder*="promo" i], input[placeholder*="código" i], input[placeholder*="code" i], input[name="promoCode"], input.comet-v2-input',
      apply: 'button[class*="promo-code-btn"], button[class*="apply-btn"], button:has(span:contains("Apply")), button:has(span:contains("Aplicar"))',
      success: ['[class*="promo-code-success"]', '[class*="comet-v2-alert-success"]'],
      error: ['[class*="promo-code-error"]', '[class*="comet-v2-alert-error"]'],
      autoApply: false,
    },
  };

  if (typeof window !== 'undefined') {
    window.AFILADOS_COUPON_STORES = AFILADOS_COUPON_STORES;
    window.AFILADOS_COUPON_STOPWORDS = COUPON_STOPWORDS;
  }
})();
