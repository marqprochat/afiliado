import { describe, it, expect } from 'vitest';
import type { ProductData } from '@afilados/shared';
import { renderTemplate } from '../src/template';

const product: ProductData = {
  source: 'SHOPEE',
  externalId: '123',
  title: 'Processador AMD Ryzen 5',
  price: 848.48,
  originalPrice: 1200,
  discountPct: 29,
  salesCount: 6,
  commissionPct: 3,
  images: ['https://img.example/a.jpg'],
  shipping: 'FREE',
  originalUrl: 'https://shopee.com.br/p-i.1.123',
  raw: {},
};
const ctx = { affiliateLink: 'https://s.shopee.com.br/abc', now: '2026-09-14T12:00:00.000Z' };

describe('renderTemplate: preco_com_cupom', () => {
  const body = '{preco}\n{#preco_com_cupom}💸 Com o cupom: {preco_com_cupom}{/preco_com_cupom}\n{link}';
  const p = { ...product, price: 100, couponCode: 'BLACK10' };

  it('mostra o preço com cupom quando o desconto em R$ é conhecido', () => {
    const out = renderTemplate(body, { ...p, couponValue: 15 }, ctx);
    expect(out).toContain('Com o cupom: R$');
    expect(out).toContain('85,00');
  });

  it('sem desconto confirmado, a linha some por inteiro', () => {
    const out = renderTemplate(body, p, ctx);
    expect(out).not.toContain('cupom');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('desconto maior ou igual ao preço é ignorado', () => {
    const out = renderTemplate(body, { ...p, couponValue: 100 }, ctx);
    expect(out).not.toContain('Com o cupom');
  });
});

describe('renderTemplate', () => {
  it('substitui variáveis básicas', () => {
    const out = renderTemplate(
      '*{titulo}*\nDe {preco_antigo} por {preco} ({desconto})\n{link}',
      product,
      ctx,
    );
    expect(out).toBe(
      '*Processador AMD Ryzen 5*\nDe R$ 1.200,00 por R$ 848,48 (-29% OFF)\nhttps://s.shopee.com.br/abc',
    );
  });

  it('renderiza frete', () => {
    expect(renderTemplate('{frete}', product, ctx)).toBe('Frete grátis');
    expect(renderTemplate('{frete}', { ...product, shipping: 'FULL' }, ctx)).toBe('Envio FULL');
    expect(renderTemplate('{frete}', { ...product, shipping: 'NONE' }, ctx)).toBe('');
    expect(renderTemplate('{frete_gratis}', product, ctx)).toBe('🚚 FRETE GRÁTIS');
    expect(renderTemplate('{frete_full}', product, ctx)).toBe('');
  });

  it('remove a linha inteira de um bloco condicional vazio', () => {
    const body = 'A\n{#cupom}Cupom: {cupom}{/cupom}\nB';
    expect(renderTemplate(body, product, ctx)).toBe('A\nB');
    expect(renderTemplate(body, { ...product, couponCode: 'X10' }, ctx)).toBe('A\nCupom: X10\nB');
  });

  it('calcula oferta relâmpago a partir de now', () => {
    const p = { ...product, flashSaleEndsAt: '2026-09-14T12:47:00.000Z' };
    expect(renderTemplate('{oferta_relampago}', p, ctx)).toBe('⚡ Faltam 47 minutos para expirar');
    expect(renderTemplate('{oferta_relampago}', product, ctx)).toBe('');
    const expired = { ...product, flashSaleEndsAt: '2026-09-14T11:00:00.000Z' };
    expect(renderTemplate('{oferta_relampago}', expired, ctx)).toBe('');
  });

  it('oferta relâmpago com mais de uma hora e data inválida', () => {
    const p = { ...product, flashSaleEndsAt: '2026-09-14T13:35:00.000Z' };
    expect(renderTemplate('{oferta_relampago}', p, ctx)).toBe('⚡ Faltam 1h35 para expirar');
    expect(renderTemplate('{oferta_relampago}', { ...product, flashSaleEndsAt: 'lixo' }, ctx)).toBe(
      '',
    );
  });

  it('vendas, cupom e cta', () => {
    expect(renderTemplate('{vendas}', product, ctx)).toBe('6');
    expect(renderTemplate('{cta}', product, { ...ctx, cta: 'Corra!' })).toBe('Corra!');
    expect(renderTemplate('{cta}', product, ctx)).toBe('');
  });

  it('mantém texto sem variáveis intacto', () => {
    expect(renderTemplate('sem nada', product, ctx)).toBe('sem nada');
  });
});
