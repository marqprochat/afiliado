import { describe, it, expect } from 'vitest';
import {
  couponDispatchSchema,
  manualSendSchema,
  templatePreviewSchema,
  templateSchema,
  MANUAL_TEXT_MAX,
} from '../src';

const targets = { sessionId: 's1', groupJids: ['g1@g.us'], mode: 'now' as const };

describe('couponDispatchSchema', () => {
  it('aplica defaults de telegramChatIds e intervalMin', () => {
    const r = couponDispatchSchema.parse({ couponIds: ['c1'], templateId: 't1', ...targets });
    expect(r.telegramChatIds).toEqual([]);
    expect(r.intervalMin).toBe(10);
  });
  it('exige ao menos um cupom e um grupo', () => {
    expect(
      couponDispatchSchema.safeParse({ couponIds: [], templateId: 't1', ...targets }).success,
    ).toBe(false);
    expect(
      couponDispatchSchema.safeParse({
        couponIds: ['c1'],
        templateId: 't1',
        ...targets,
        groupJids: [],
      }).success,
    ).toBe(false);
  });
  it('rejeita modo inválido', () => {
    expect(
      couponDispatchSchema.safeParse({
        couponIds: ['c1'],
        templateId: 't1',
        ...targets,
        mode: 'later',
      }).success,
    ).toBe(false);
  });
});

describe('manualSendSchema', () => {
  it('apara o texto e aceita imagem opcional', () => {
    const r = manualSendSchema.parse({ text: '  Olá  ', ...targets });
    expect(r.text).toBe('Olá');
    expect(r.imageUrl).toBeUndefined();
  });
  it('rejeita texto vazio, longo demais e imagem que não é URL', () => {
    expect(manualSendSchema.safeParse({ text: '   ', ...targets }).success).toBe(false);
    expect(
      manualSendSchema.safeParse({ text: 'x'.repeat(MANUAL_TEXT_MAX + 1), ...targets }).success,
    ).toBe(false);
    expect(manualSendSchema.safeParse({ text: 'ok', imageUrl: 'nao-url', ...targets }).success).toBe(
      false,
    );
  });
});

describe('manualSendSchema.imageUrl (só http/https)', () => {
  const parse = (imageUrl: string) => manualSendSchema.safeParse({ text: 'ok', imageUrl, ...targets }).success;
  it('aceita https e http', () => {
    expect(parse('https://cdn.example.com/a.jpg')).toBe(true);
    expect(parse('http://cdn.example.com/a.jpg')).toBe(true);
  });
  it('rejeita ftp:, file: e javascript:', () => {
    expect(parse('ftp://cdn.example.com/a.jpg')).toBe(false);
    expect(parse('file:///etc/passwd')).toBe(false);
    expect(parse('javascript:alert(1)')).toBe(false);
  });
});

describe('templates com kind', () => {
  it('templateSchema aceita kind opcional', () => {
    expect(templateSchema.parse({ name: 'a', body: 'b' }).kind).toBeUndefined();
    expect(templateSchema.parse({ name: 'a', body: 'b', kind: 'COUPON' }).kind).toBe('COUPON');
    expect(templateSchema.safeParse({ name: 'a', body: 'b', kind: 'X' }).success).toBe(false);
  });
  it('templatePreviewSchema aceita kind e couponId', () => {
    const r = templatePreviewSchema.parse({ body: '{codigo}', kind: 'COUPON', couponId: 'c1' });
    expect(r.kind).toBe('COUPON');
    expect(r.couponId).toBe('c1');
  });
});
