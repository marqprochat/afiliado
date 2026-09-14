import { describe, it, expect } from 'vitest';
import { batchCreateSchema, settingsUpdateSchema, waConnectSchema } from '../src/api';

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
});
