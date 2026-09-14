import { describe, it, expect } from 'vitest';
import { generateSubId } from '../src/subid';

describe('generateSubId', () => {
  const now = new Date('2026-09-14T15:04:00-03:00');
  it('substitui tokens', () => {
    expect(generateSubId('{yyyyMMdd}-{batchId}', { now, batchId: 'ckx1' })).toBe('20260914-ckx1');
  });
  it('sanitiza e limita', () => {
    const out = generateSubId('{group}', { now, groupJid: '5511999@g.us' });
    expect(out).toBe('5511999gus');
    expect(generateSubId('x'.repeat(80), { now })).toHaveLength(50);
  });
});
