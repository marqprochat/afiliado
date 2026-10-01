import { describe, it, expect } from 'vitest';
import { AI_DEFAULTS, aiSettingsUpdateSchema, aiTestSchema, API_ERROR_CODES } from '../src';

describe('ai schemas', () => {
  it('defaults batem com o spec', () => {
    expect(AI_DEFAULTS).toMatchObject({
      enabled: false,
      tone: 'empolgado',
      emojiLevel: 'medio',
      maxChars: 140,
      temperature: 0.9,
      extraInstructions: '',
    });
  });
  it('PUT aceita corpo parcial e apiKey', () => {
    const r = aiSettingsUpdateSchema.parse({ model: 'combo', apiKey: 'sk-1' });
    expect(r).toEqual({ model: 'combo', apiKey: 'sk-1' });
  });
  it('rejeita tone/emoji/maxChars/temperature fora do domínio', () => {
    expect(() => aiSettingsUpdateSchema.parse({ tone: 'agressivo' })).toThrow();
    expect(() => aiSettingsUpdateSchema.parse({ emojiLevel: 'mil' })).toThrow();
    expect(() => aiSettingsUpdateSchema.parse({ maxChars: 10 })).toThrow();
    expect(() => aiSettingsUpdateSchema.parse({ maxChars: 301 })).toThrow();
    expect(() => aiSettingsUpdateSchema.parse({ temperature: 2.5 })).toThrow();
    expect(() => aiSettingsUpdateSchema.parse({ extraInstructions: 'x'.repeat(501) })).toThrow();
  });
  it('teste aceita productId opcional', () => {
    expect(aiTestSchema.parse({ productId: 'p1', model: 'm' })).toEqual({ productId: 'p1', model: 'm' });
    expect(aiTestSchema.parse({})).toEqual({});
  });
  it('AI_ERROR é um código de erro da API', () => {
    expect(API_ERROR_CODES).toContain('AI_ERROR');
  });
});
