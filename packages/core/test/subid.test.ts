import { describe, it, expect } from 'vitest';
import { generateSubId, sanitizeSubId, composeLinkSubIds, applyAffiliateTag } from '../src/subid';

describe('generateSubId', () => {
  const now = new Date('2026-09-14T15:04:00-03:00');
  it('substitui tokens', () => {
    expect(generateSubId('{yyyyMMdd}-{batchId}', { now, batchId: 'ckx1' })).toBe('20260914ckx1');
  });
  it('sanitiza e limita', () => {
    const out = generateSubId('{group}', { now, groupJid: '5511999@g.us' });
    expect(out).toBe('5511999gus');
    expect(generateSubId('x'.repeat(80), { now })).toHaveLength(50);
  });
  it('só usa caracteres aceitos pela Shopee (letras e números, sem hífen/underscore)', () => {
    const out = generateSubId('{yyyyMMdd}-mirror-{batchId}', { now, batchId: 'cmu8-nz.nw5' });
    expect(out).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('SubID de afiliado', () => {
  it('sanitizeSubId mantém só letras/números e limita a 50', () => {
    expect(sanitizeSubId('joão-silva_1')).toBe('joosilva1');
    expect(sanitizeSubId(null)).toBe('');
    expect(sanitizeSubId('a'.repeat(80))).toHaveLength(50);
  });
  it('Shopee: afiliado + padrão em subIds; sem afiliado usa só o padrão', () => {
    expect(composeLinkSubIds('SHOPEE', 'joao', '20261016lote')).toEqual({
      subId: 'joao',
      extraSubIds: ['20261016lote'],
    });
    expect(composeLinkSubIds('SHOPEE', null, '20261016lote')).toEqual({
      subId: '20261016lote',
      extraSubIds: [],
    });
  });
  it('AliExpress e Awin: só o afiliado', () => {
    expect(composeLinkSubIds('ALIEXPRESS', 'joao', 'x')).toEqual({
      subId: 'joao',
      extraSubIds: [],
    });
    expect(composeLinkSubIds('AWIN', '  ', 'x')).toEqual({ subId: 'x', extraSubIds: [] });
  });
  it('applyAffiliateTag troca a tag só quando há identificador', () => {
    expect(applyAffiliateTag({ tag: 'dono-20', mattWord: 'm' }, 'joao-20')).toEqual({
      tag: 'joao-20',
      mattWord: 'm',
    });
    expect(applyAffiliateTag({ tag: 'dono-20' }, ' ')).toEqual({ tag: 'dono-20' });
    expect(applyAffiliateTag({ tag: 'dono-20' }, null)).toEqual({ tag: 'dono-20' });
  });
});
