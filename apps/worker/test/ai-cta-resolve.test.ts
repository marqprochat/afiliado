import { describe, it, expect, vi } from 'vitest';
import { encryptJson } from '@afilados/db';
import { AiCtaError } from '@afilados/core';
import type { ProductData } from '@afilados/shared';
import { resolveItemCta, templateUsesCta } from '../src/lib/ai-cta';

const product: ProductData = {
  source: 'SHOPEE', title: 'Fone', price: 99.9, images: [], shipping: 'FREE',
  originalUrl: 'https://shopee.com.br/p/1', raw: {},
};
const stored = {
  enabled: true,
  baseUrl: 'https://router.example.com/v1',
  model: 'combo',
  encryptedApiKey: encryptJson({ apiKey: 'sk-test-1234' }).toString('base64'),
};
const log = { warn: vi.fn() };
const base = { templateBody: '{cta}\n{titulo}', product, batchItemId: 'bi1', log };

describe('templateUsesCta', () => {
  it('detecta {cta} e {#cta}', () => {
    expect(templateUsesCta('{titulo} {cta}')).toBe(true);
    expect(templateUsesCta('{#cta}{cta}{/cta}')).toBe(true);
    expect(templateUsesCta('{#cta}x{/cta}')).toBe(true);
    expect(templateUsesCta('{titulo} {link}')).toBe(false);
  });
});

describe('resolveItemCta', () => {
  it('gera o CTA com a config descriptografada e defaults aplicados', async () => {
    const generate = vi.fn(async () => 'Corre! 🔥');
    const out = await resolveItemCta({ ...base, settings: { ai: stored }, generate: generate as never });
    expect(out).toBe('Corre! 🔥');
    const [p, cfg, opts] = generate.mock.calls[0] as unknown as [ProductData, Record<string, unknown>, { validateBaseUrl: unknown }];
    expect(p.title).toBe('Fone');
    expect(cfg).toMatchObject({ baseUrl: stored.baseUrl, model: 'combo', apiKey: 'sk-test-1234', tone: 'empolgado', emojiLevel: 'medio', maxChars: 140, temperature: 0.9 });
    expect(typeof opts.validateBaseUrl).toBe('function');
  });
  it.each([
    ['sem config', {}],
    ['desativado', { ai: { ...stored, enabled: false } }],
  ])('%s: não chama a IA', async (_n, settings) => {
    const generate = vi.fn();
    expect(await resolveItemCta({ ...base, settings, generate: generate as never })).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });
  it('template sem {cta}: não chama a IA', async () => {
    const generate = vi.fn();
    expect(await resolveItemCta({ ...base, templateBody: '{titulo} {link}', settings: { ai: stored }, generate: generate as never })).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });
  it('falha da IA: devolve vazio e loga sem a apiKey', async () => {
    log.warn.mockClear();
    const generate = vi.fn(async () => {
      throw new AiCtaError('http', 'IA respondeu HTTP 500', 500);
    });
    expect(await resolveItemCta({ ...base, settings: { ai: stored }, generate: generate as never })).toBe('');
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [obj] = log.warn.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(obj).toMatchObject({ batchItemId: 'bi1', kind: 'http', status: 500 });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('sk-test-1234');
  });
  it('apiKey ilegível ou config incompleta: vazio, sem chamar a IA', async () => {
    const generate = vi.fn();
    expect(await resolveItemCta({ ...base, settings: { ai: { ...stored, encryptedApiKey: 'AAAA' } }, generate: generate as never })).toBe('');
    expect(await resolveItemCta({ ...base, settings: { ai: { ...stored, model: '' } }, generate: generate as never })).toBe('');
    expect(generate).not.toHaveBeenCalled();
  });
});
