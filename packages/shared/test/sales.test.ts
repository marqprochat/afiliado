import { describe, it, expect } from 'vitest';
import { parseSalesQuery, AWIN_WEBHOOK_TOKEN_KEY } from '../src/sales';

const NOW = new Date('2026-11-25T12:00:00Z');

describe('parseSalesQuery', () => {
  it('padrão: últimos 30 dias, página 1, sem status', () => {
    const q = parseSalesQuery({}, NOW);
    expect(q.to.toISOString()).toBe(NOW.toISOString());
    expect(q.from.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(q.page).toBe(1);
    expect(q.status).toBeUndefined();
  });

  it('aceita from/to ISO, status e página', () => {
    const q = parseSalesQuery(
      {
        from: '2026-11-01T03:00:00.000Z',
        to: '2026-11-10T03:00:00.000Z',
        status: 'APPROVED',
        page: '3',
      },
      NOW,
    );
    expect(q.from.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(q.to.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(q).toMatchObject({ status: 'APPROVED', page: 3 });
  });

  it('rejeita intervalo invertido e status inválido', () => {
    expect(() =>
      parseSalesQuery({ from: '2026-11-10T00:00:00Z', to: '2026-11-01T00:00:00Z' }, NOW),
    ).toThrow();
    expect(() => parseSalesQuery({ status: 'XPTO' }, NOW)).toThrow();
  });

  it('chave do token do webhook', () => {
    expect(AWIN_WEBHOOK_TOKEN_KEY).toBe('awinWebhookToken');
  });
});
