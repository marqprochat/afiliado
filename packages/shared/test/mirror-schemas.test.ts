import { describe, it, expect } from 'vitest';
import { mirrorRuleSchema, mirrorLogsQuerySchema, marketplaceUpdateSchema } from '../src/api';
import { hasTagCredentials, requiredTagFields } from '../src/marketplaces';

describe('mirrorRuleSchema', () => {
  const base = { name: 'R', sessionId: 's', sourceJids: ['a@g.us'], targetJids: ['b@g.us'] };
  it('defaults', () => {
    expect(mirrorRuleSchema.parse(base)).toEqual({
      ...base,
      mode: 'CLONE',
      mediaMode: 'PREVIEW',
      dedupHours: 12,
      enabled: true,
    });
  });
  it('rejeita origem = destino', () => {
    expect(() => mirrorRuleSchema.parse({ ...base, targetJids: ['a@g.us'] })).toThrow(/destino/);
  });
  it('rejeita listas vazias e dedup fora do limite', () => {
    expect(() => mirrorRuleSchema.parse({ ...base, sourceJids: [] })).toThrow();
    expect(() => mirrorRuleSchema.parse({ ...base, dedupHours: 0 })).toThrow();
    expect(() => mirrorRuleSchema.parse({ ...base, dedupHours: 169 })).toThrow();
  });
});

describe('mirrorLogsQuerySchema', () => {
  it('defaults e limite', () => {
    expect(mirrorLogsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(() => mirrorLogsQuerySchema.parse({ limit: 201 })).toThrow();
    expect(mirrorLogsQuerySchema.parse({ status: 'ERROR', limit: '10' })).toEqual({
      status: 'ERROR',
      limit: 10,
    });
  });
});

describe('tag credentials', () => {
  it('campos obrigatórios por loja', () => {
    expect(requiredTagFields('AMAZON')).toEqual(['tag']);
    expect(requiredTagFields('MERCADOLIVRE')).toEqual(['mattWord', 'mattTool']);
    expect(hasTagCredentials('MERCADOLIVRE', { mattWord: 'x' })).toBe(false);
    expect(hasTagCredentials('MERCADOLIVRE', { mattWord: 'x', mattTool: '1' })).toBe(true);
    expect(hasTagCredentials('MAGALU', { tag: 'loja' })).toBe(true);
  });
  it('marketplaceUpdateSchema aceita mattWord/mattTool', () => {
    expect(marketplaceUpdateSchema.parse({ mattWord: 'minhaid', mattTool: '12345678' })).toEqual({
      mattWord: 'minhaid',
      mattTool: '12345678',
    });
    expect(() => marketplaceUpdateSchema.parse({ mattTool: 'abc' })).toThrow();
  });
});
