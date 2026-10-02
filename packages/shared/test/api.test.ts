import { describe, it, expect } from 'vitest';
import { batchCreateSchema, batchSendProductsSchema, settingsUpdateSchema, waConnectSchema } from '../src/api';

describe('api schemas', () => {
  it('batchCreate exige ao menos um grupo e intervalo >= 1', () => {
    expect(() =>
      batchCreateSchema.parse({
        name: 'x',
        sessionId: 's',
        templateId: 't',
        groupJids: [],
        intervalMin: 5,
      }),
    ).toThrow();
    expect(() =>
      batchCreateSchema.parse({
        name: 'x',
        sessionId: 's',
        templateId: 't',
        groupJids: ['a@g.us'],
        intervalMin: 0,
      }),
    ).toThrow();
    const ok = batchCreateSchema.parse({
      name: 'x',
      sessionId: 's',
      templateId: 't',
      groupJids: ['a@g.us'],
      intervalMin: 5,
    });
    expect(ok).toMatchObject({ mediaMode: 'IMAGE', shuffled: false, productIds: undefined });
  });
  it('settingsUpdate valida HH:mm', () => {
    expect(() => settingsUpdateSchema.parse({ window: { startTime: '7:30' } })).toThrow();
    expect(settingsUpdateSchema.parse({ window: { startTime: '07:30' }, queueLimit: 100 })).toEqual(
      {
        window: { startTime: '07:30' },
        queueLimit: 100,
      },
    );
  });
  it('waConnect exige phone no modo pair', () => {
    expect(() => waConnectSchema.parse({ mode: 'pair' })).toThrow();
    expect(waConnectSchema.parse({ mode: 'qr' })).toEqual({ mode: 'qr' });
  });
  describe('batchSendProductsSchema', () => {
    it('aceita productIds e defaulta position para end', () => {
      const parsed = batchSendProductsSchema.parse({ productIds: ['p1', 'p2'] });
      expect(parsed).toEqual({ productIds: ['p1', 'p2'], position: 'end' });
    });
    it('aceita as 3 posições válidas: shuffle, start, end', () => {
      expect(batchSendProductsSchema.parse({ productIds: ['p1'], position: 'shuffle' })).toEqual({
        productIds: ['p1'],
        position: 'shuffle',
      });
      expect(batchSendProductsSchema.parse({ productIds: ['p1'], position: 'start' })).toEqual({
        productIds: ['p1'],
        position: 'start',
      });
      expect(batchSendProductsSchema.parse({ productIds: ['p1'], position: 'end' })).toEqual({
        productIds: ['p1'],
        position: 'end',
      });
    });
    it('rejeita productIds vazio', () => {
      expect(() => batchSendProductsSchema.parse({ productIds: [] })).toThrow();
    });
    it('rejeita posição inválida', () => {
      expect(() =>
        batchSendProductsSchema.parse({ productIds: ['p1'], position: 'invalid' as never }),
      ).toThrow();
    });
  });
});

