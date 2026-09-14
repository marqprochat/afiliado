import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson } from '../src/crypto';

const key = 'a'.repeat(64);

describe('crypto', () => {
  it('round-trip', () => {
    const buf = encryptJson({ appId: '1', secret: 's3' }, key);
    expect(decryptJson(buf, key)).toEqual({ appId: '1', secret: 's3' });
  });
  it('mesmo payload gera cifras diferentes (IV aleatório)', () => {
    expect(encryptJson('x', key).equals(encryptJson('x', key))).toBe(false);
  });
  it('chave errada falha', () => {
    const buf = encryptJson('x', key);
    expect(() => decryptJson(buf, 'b'.repeat(64))).toThrow();
  });
  it('chave inválida é rejeitada', () => {
    expect(() => encryptJson('x', 'curta')).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
