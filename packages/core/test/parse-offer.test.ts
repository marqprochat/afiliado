import { describe, it, expect } from 'vitest';
import { parseOfferText } from '../src/parse-offer';

describe('parseOfferText', () => {
  it('detecta título, preço de/por, cupom e links em mensagem padrão', () => {
    const text = `🔥 Fone de Ouvido Bluetooth JBL Wave Buds
❌ De R$ 299,00
✅ Por apenas R$ 189,90 no Pix
🎟️ Cupom: VEM10
🛒 Compre aqui: https://shopee.com.br/product/123/456`;

    const parsed = parseOfferText(text);

    expect(parsed.title).toBe('Fone de Ouvido Bluetooth JBL Wave Buds');
    expect(parsed.originalPrice).toBe(299.0);
    expect(parsed.price).toBe(189.9);
    expect(parsed.discountPct).toBe(36);
    expect(parsed.coupon).toBe('VEM10');
    expect(parsed.urls).toEqual(['https://shopee.com.br/product/123/456']);
  });

  it('detecta preço único e código com asterisco ou aspas', () => {
    const text = `Smartphone Samsung Galaxy A55 5G
R$ 1.699,00 à vista
Cupom: *PROMO50*
https://www.mercadolivre.com.br/p/MLB123`;

    const parsed = parseOfferText(text);

    expect(parsed.title).toBe('Smartphone Samsung Galaxy A55 5G');
    expect(parsed.price).toBe(1699.0);
    expect(parsed.coupon).toBe('PROMO50');
    expect(parsed.urls).toEqual(['https://www.mercadolivre.com.br/p/MLB123']);
  });

  it('detecta link encurtado e % OFF explícito', () => {
    const text = `Smart TV 50 Polegadas 4K
De R$ 2.499,00 por R$ 1.899,00 (24% OFF)
Voucher: TV100
https://amzn.to/3xyz`;

    const parsed = parseOfferText(text);

    expect(parsed.title).toBe('Smart TV 50 Polegadas 4K');
    expect(parsed.originalPrice).toBe(2499.0);
    expect(parsed.price).toBe(1899.0);
    expect(parsed.discountPct).toBe(24);
    expect(parsed.coupon).toBe('TV100');
    expect(parsed.urls).toEqual(['https://amzn.to/3xyz']);
  });

  it('funciona quando não há cupom na mensagem', () => {
    const text = `Camisa Oficial Seleção Brasileira
Por R$ 149,90
https://www.magazineluiza.com.br/camisa/p/123`;

    const parsed = parseOfferText(text);

    expect(parsed.title).toBe('Camisa Oficial Seleção Brasileira');
    expect(parsed.price).toBe(149.9);
    expect(parsed.coupon).toBeUndefined();
    expect(parsed.urls).toEqual(['https://www.magazineluiza.com.br/camisa/p/123']);
  });
});
