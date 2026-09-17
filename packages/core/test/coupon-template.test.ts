import { describe, it, expect } from 'vitest';
import { renderCouponTemplate } from '../src/template';

describe('renderCouponTemplate', () => {
  it('substitui as variáveis do cupom', () => {
    const body = '🎟️ *{codigo}* na {loja}! {descricao} — válido até {validade}';
    const out = renderCouponTemplate(
      body,
      {
        store: 'AMAZON',
        code: 'PROMO10',
        description: '10% OFF em eletrônicos',
        expiresAt: '2026-12-31T23:59:59.000Z',
      },
      { now: '2026-09-17T12:00:00.000Z' },
    );
    expect(out).toContain('PROMO10');
    expect(out).toContain('10% OFF em eletrônicos');
    expect(out).toContain('31/12/2026');
  });

  it('mostra "sem validade definida" quando expiresAt é nulo', () => {
    const out = renderCouponTemplate(
      'Validade: {validade}',
      { store: 'SHOPEE', code: 'X', description: 'd', expiresAt: null },
      { now: '2026-09-17T12:00:00.000Z' },
    );
    expect(out).toBe('Validade: sem validade definida');
  });
});
