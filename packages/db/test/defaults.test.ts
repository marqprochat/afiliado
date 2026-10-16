import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/defaults';

describe('DEFAULT_SETTINGS', () => {
  it('é congelado: nenhum consumidor consegue alterar o padrão global', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(() => {
      (DEFAULT_SETTINGS as Record<string, unknown>).subIdPattern = 'outro';
    }).toThrow();
    expect(DEFAULT_SETTINGS.subIdPattern).toBe('{yyyyMMdd}-{batchId}');
  });
});
