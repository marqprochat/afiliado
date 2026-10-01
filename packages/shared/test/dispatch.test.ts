import { describe, it, expect } from 'vitest';
import {
  couponDispatchSchema,
  manualSendSchema,
  templatePreviewSchema,
  templateSchema,
  MANUAL_TEXT_MAX,
  MAX_DISPATCH_NOW,
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

describe('couponDispatchSchema: limite do envio imediato', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
  it('MAX_DISPATCH_NOW é 20', () => {
    expect(MAX_DISPATCH_NOW).toBe(20);
  });
  it('mode now aceita até 20 cupons e rejeita 21 com mensagem em pt-BR', () => {
    expect(
      couponDispatchSchema.safeParse({ couponIds: ids(20), templateId: 't1', ...targets }).success,
    ).toBe(true);
    const r = couponDispatchSchema.safeParse({ couponIds: ids(21), templateId: 't1', ...targets });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.message).toBe(
        "Envio imediato aceita no máximo 20 cupons; use 'Colocar na fila'",
      );
    }
  });
  it('mode queue continua aceitando mais de 20', () => {
    expect(
      couponDispatchSchema.safeParse({
        couponIds: ids(50),
        templateId: 't1',
        ...targets,
        mode: 'queue',
      }).success,
    ).toBe(true);
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

describe('manualSendSchema: upload de arquivo de imagem', () => {
  const validJpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
  const validPngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64');
  const validWebpBase64 = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]).toString('base64');

  it('aceita imagem válida em JPEG, PNG e WebP', () => {
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: validJpegBase64,
        imageType: 'image/jpeg',
        ...targets,
      }).success,
    ).toBe(true);
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: validPngBase64,
        imageType: 'image/png',
        ...targets,
      }).success,
    ).toBe(true);
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: validWebpBase64,
        imageType: 'image/webp',
        ...targets,
      }).success,
    ).toBe(true);
  });

  it('rejeita quando imageUrl e imageData/imageType são fornecidos juntos', () => {
    const r = manualSendSchema.safeParse({
      text: 'ok',
      imageUrl: 'https://cdn.example.com/a.jpg',
      imageData: validJpegBase64,
      imageType: 'image/jpeg',
      ...targets,
    });
    expect(r.success).toBe(false);
  });

  it('rejeita imageData sem imageType ou imageType sem imageData', () => {
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: validJpegBase64,
        ...targets,
      }).success,
    ).toBe(false);
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageType: 'image/jpeg',
        ...targets,
      }).success,
    ).toBe(false);
  });

  it('rejeita imageType não permitido (ex: image/gif)', () => {
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: validJpegBase64,
        imageType: 'image/gif',
        ...targets,
      }).success,
    ).toBe(false);
  });

  it('rejeita assinatura real incompatível (fake JPEG/PNG/WebP)', () => {
    const fakeBase64 = Buffer.from('isto nao e uma imagem valida').toString('base64');
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: fakeBase64,
        imageType: 'image/jpeg',
        ...targets,
      }).success,
    ).toBe(false);

    // Header PNG passado como image/jpeg
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: validPngBase64,
        imageType: 'image/jpeg',
        ...targets,
      }).success,
    ).toBe(false);
  });

  it('rejeita imagem com mais de 5 MB pós-decode', () => {
    // 5 MB = 5 * 1024 * 1024 = 5242880 bytes
    const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const big = Buffer.concat([header, Buffer.alloc(5 * 1024 * 1024)]);
    expect(
      manualSendSchema.safeParse({
        text: 'ok',
        imageData: big.toString('base64'),
        imageType: 'image/jpeg',
        ...targets,
      }).success,
    ).toBe(false);
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
