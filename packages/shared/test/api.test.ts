import { describe, it, expect } from 'vitest';
import {
  batchCreateSchema,
  batchSendProductsSchema,
  batchShareSchema,
  settingsUpdateSchema,
  waConnectSchema,
} from '../src/api';

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
    expect(
      settingsUpdateSchema.parse({ window: { startTime: '07:30' }, globalRateLimitPerMin: 10 }),
    ).toEqual({
      window: { startTime: '07:30' },
      globalRateLimitPerMin: 10,
    });
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
  describe('batchShareSchema', () => {
    it('aceita produtos e lotes e defaulta position para end', () => {
      const r = batchShareSchema.parse({ productIds: ['p1'], batchIds: ['b1', 'b2'] });
      expect(r.position).toBe('end');
      expect(r.batchIds).toEqual(['b1', 'b2']);
    });
    it('aceita as 3 posições', () => {
      for (const position of ['shuffle', 'start', 'end'] as const) {
        expect(
          batchShareSchema.parse({ productIds: ['p1'], batchIds: ['b1'], position }).position,
        ).toBe(position);
      }
    });
    it('rejeita productIds ou batchIds vazios', () => {
      expect(batchShareSchema.safeParse({ productIds: [], batchIds: ['b1'] }).success).toBe(false);
      expect(batchShareSchema.safeParse({ productIds: ['p1'], batchIds: [] }).success).toBe(false);
    });
    it('rejeita mais de 20 lotes e posição inválida', () => {
      const many = Array.from({ length: 21 }, (_, i) => `b${i}`);
      expect(batchShareSchema.safeParse({ productIds: ['p1'], batchIds: many }).success).toBe(
        false,
      );
      expect(
        batchShareSchema.safeParse({ productIds: ['p1'], batchIds: ['b1'], position: 'meio' })
          .success,
      ).toBe(false);
    });
  });
});
