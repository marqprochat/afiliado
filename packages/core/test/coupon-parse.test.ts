import { describe, it, expect } from 'vitest';
import { parseCouponsFromText } from '../src/coupon-parse';

describe('parseCouponsFromText', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');

  it('1. Mensagem simples de cupom Shopee', () => {
    const text = '🔥 CUPOM: BEMVINDO10 — 10% OFF na Shopee\nhttps://shopee.com.br/product/123/456';
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      store: 'SHOPEE',
      code: 'BEMVINDO10',
      discountType: 'PERCENT',
      discountValue: 10,
      sourceUrl: 'https://shopee.com.br/product/123/456',
    });
  });

  it('2. Mensagem Amazon com valor fixo, mínimo e data de validade', () => {
    const text =
      'Amazon: use o código *PRIMEIRA20* e ganhe R$ 20 OFF acima de R$ 100. Válido até 30/09\nhttps://www.amazon.com.br/dp/B08N5WRWNW';
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      store: 'AMAZON',
      code: 'PRIMEIRA20',
      discountType: 'FIXED',
      discountValue: 20,
      minSpend: 100,
      sourceUrl: 'https://www.amazon.com.br/dp/B08N5WRWNW',
    });
    expect(res[0]!.expiresAt).toBeDefined();
    expect(res[0]!.expiresAt).toContain('2026-09-30');
  });

  it('3. Mensagem com múltiplos blocos e múltiplas lojas', () => {
    const text = `
🔥 CUPOM SHOPEE
Código: SHOPEE15
15% de desconto acima de R$ 50
Válido hoje
https://shopee.com.br/

---

⚡ MERCADO LIVRE
Cupom: MELI30OFF
R$ 30 OFF em compras a partir de R$ 199
https://mercadolivre.com.br/p/MLB12345
    `;
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({
      store: 'SHOPEE',
      code: 'SHOPEE15',
      discountType: 'PERCENT',
      discountValue: 15,
      minSpend: 50,
    });
    expect(res[1]).toMatchObject({
      store: 'MERCADOLIVRE',
      code: 'MELI30OFF',
      discountType: 'FIXED',
      discountValue: 30,
      minSpend: 199,
    });
  });

  it('4. Mensagem Magalu com cupom e link magazinevoce', () => {
    const text = `
Magazine Luiza
Use o voucher MAGALUAPP e ganhe Frete Grátis acima de R$ 79
Confira: https://www.magazinevoce.com.br/magazineafiliados/p/12345/
    `;
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      store: 'MAGALU',
      code: 'MAGALUAPP',
      discountType: 'FREE_SHIPPING',
      minSpend: 79,
    });
  });

  it('5. Mensagem AliExpress com código alfanumérico e defaultStore', () => {
    const text = 'Super oferta! Cupom: BRCHOICE05 dá R$ 25 de desconto em compras acima de R$ 150';
    const res = parseCouponsFromText(text, { defaultStore: 'ALIEXPRESS', now });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      store: 'ALIEXPRESS',
      code: 'BRCHOICE05',
      discountType: 'FIXED',
      discountValue: 25,
      minSpend: 150,
    });
  });

  it('6. Descarte de falso positivo sem código (Black Friday 50% OFF)', () => {
    const text = 'BLACK FRIDAY! 50% OFF em todo o site da Amazon! Aproveite hoje mesmo!';
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(0);
  });

  it('7. Mensagem com formatação crases `CUPOM10` e contexto de cupom', () => {
    const text = 'Galera, use `MELI10` no checkout do Mercado Livre para 10% off!';
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      store: 'MERCADOLIVRE',
      code: 'MELI10',
      discountType: 'PERCENT',
      discountValue: 10,
    });
  });

  it('8. Deduplicação de mesmo cupom e loja na mesma chamada', () => {
    const text = `
Cupom Shopee: BEMVINDO10
10% off

Cupom Shopee: BEMVINDO10
10% off
    `;
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(1);
    expect(res[0]!.code).toBe('BEMVINDO10');
  });

  it('9. Loja desconhecida fica null se não houver defaultStore', () => {
    const text = 'Cupom: DESCONTO10 para 10% off em todo site';
    const res = parseCouponsFromText(text, { now });
    expect(res).toHaveLength(1);
    expect(res[0]!.store).toBeNull();
    expect(res[0]!.code).toBe('DESCONTO10');
  });
});
