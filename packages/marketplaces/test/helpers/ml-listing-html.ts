export function money(frac: string, cents?: string): string {
  return (
    '<span class="andes-money-amount poly-price__amount">' +
    '<span class="andes-money-amount__currency"><span class="andes-money-amount__currency-symbol">R$</span></span>' +
    `<span class="andes-money-amount__fraction">${frac}</span>` +
    (cents ? `<span class="andes-money-amount__cents">${cents}</span>` : '') +
    '</span>'
  );
}

export interface CardOpts {
  title?: string;
  href?: string;
  image?: string;
  prev?: string;
  cur?: [string, string?];
  discount?: string;
  note?: string;
  shipping?: string;
  full?: boolean;
  countdown?: boolean;
}

export const CATALOG_HREF =
  'https://www.mercadolivre.com.br/smartwatch-huawei-band-10/p/MLB46202402?pdp_filters=deal%3AMLB779362-1#polycard_client=offers&amp;position=1&amp;wid=MLB4083441037&amp;sid=offers';

/** Card `poly-card` com o mesmo desenho do HTML real das listagens (subconjunto relevante). */
export function polyCard(o: CardOpts = {}): string {
  const title = o.title ?? 'Smartwatch Huawei Band 10';
  const image =
    o.image ?? 'https://http2.mlstatic.com/D_Q_NP_2X_772291-MLA100008466405_122025-AB.webp';
  const cur = o.cur ?? ['183', '08'];
  return (
    '<div class="andes-card poly-card poly-card--grid-card">' +
    '<div class="poly-card__portada">' +
    (image ? `<img class="poly-component__picture" src="${image}" alt="">` : '') +
    (o.countdown
      ? '<div class="poly-component__highlight-countdown poly-component__widget"><span class="poly-highlight-countdown__text"></span></div>'
      : '') +
    '</div><div class="poly-card__content">' +
    '<h3 class="poly-component__title-wrapper">' +
    `<a href="${o.href ?? CATALOG_HREF}" target="_self" class="poly-component__title">${title}</a></h3>` +
    '<div class="poly-component__price">' +
    (o.prev
      ? `<div class="poly-price__labels"><span class="poly-price__label"><s class="andes-money-amount polylabel-price andes-money-amount--previous"><span class="andes-money-amount__fraction">${o.prev}</span></s></span></div>`
      : '') +
    `<div class="poly-price__current">${money(cur[0], cur[1])}` +
    (o.discount
      ? `<span class="poly-price__discount-polylabel"><span class="polylabel-pill">${o.discount}</span></span>`
      : '') +
    '</div>' +
    (o.note ? `<span class="poly-price__unit-description">${o.note}</span>` : '') +
    '<span class="poly-price__installments">ou <span class="andes-money-amount"><span class="andes-money-amount__fraction">199</span></span> em outros meios</span>' +
    '</div>' +
    '<div class="poly-component__shipping-v2"><div class="poly-shipping-v2__item"><span>' +
    (o.shipping ?? '') +
    (o.full
      ? '<svg aria-label="Enviado pelo FULL" role="img" class="polylabel-icon"><use href="#poly_full"></use></svg>'
      : '') +
    '</span></div></div></div></div>'
  );
}

/** Página mínima: cards + o JSON embutido onde o ML guarda o `period_end` de cada contagem. */
export function listingPage(cards: string[], periodEnds: string[] = []): string {
  const ctx = periodEnds
    .map((e) => `{"countdown":{"animation":true,"period_end":"${e}"}}`)
    .join(',');
  return (
    '<!doctype html><html><body><div class="items-with-smart-groups">' +
    cards.join('\n') +
    `</div><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"items":[${ctx}]}</script></body></html>`
  );
}
