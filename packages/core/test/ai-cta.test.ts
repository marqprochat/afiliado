import { describe, it, expect, vi } from 'vitest';
import { sanitizeCta, buildCtaPrompt, generateCta, AiCtaError, type AiCtaConfig } from '../src/ai-cta';
import { formatBRL } from '../src/money';
import type { ProductData } from '@afilados/shared';

describe('sanitizeCta', () => {
  it('remove aspas e markdown, mantém emojis', () => {
    expect(sanitizeCta('  "**Nossaaa!** Que oferta 🔥"  ', 140)).toBe('Nossaaa! Que oferta 🔥');
    expect(sanitizeCta('“Corre que vai acabar”', 140)).toBe('Corre que vai acabar');
    expect(sanitizeCta('`Bora` ~garantir~ _agora_', 140)).toBe('Bora garantir agora');
  });
  it('mantém apóstrofo no meio da palavra e tira nas pontas', () => {
    expect(sanitizeCta("'Garrafa d'água top'", 140)).toBe("Garrafa d'água top");
  });
  it('transforma quebras de linha em espaço (uma frase só)', () => {
    expect(sanitizeCta('Oferta\n\nincrível   demais', 140)).toBe('Oferta incrível demais');
  });
  it('rejeita vazio e só-markdown', () => {
    expect(sanitizeCta('', 140)).toBeNull();
    expect(sanitizeCta('   \n ', 140)).toBeNull();
    expect(sanitizeCta('****', 140)).toBeNull();
  });
  it('rejeita texto com URL', () => {
    expect(sanitizeCta('Compre em https://loja.com/x agora', 140)).toBeNull();
    expect(sanitizeCta('Veja www.loja.com.br', 140)).toBeNull();
    expect(sanitizeCta('Só em ofertas.com hoje', 140)).toBeNull();
  });
  it('corta em maxChars, preferindo fronteira de palavra', () => {
    expect(sanitizeCta('aaaa bbbb cccc dddd', 14)).toBe('aaaa bbbb cccc');
    expect(sanitizeCta('aaaa bbbb ccccdddd', 14)).toBe('aaaa bbbb');
  });
  it('corta por code point sem partir emoji', () => {
    expect(sanitizeCta('🔥'.repeat(10), 5)).toBe('🔥'.repeat(5));
  });
});

const product: ProductData = {
  source: 'SHOPEE',
  title: 'Fone Bluetooth TWS',
  price: 89.9,
  originalPrice: 149.9,
  discountPct: 40,
  salesCount: 1200,
  shipping: 'FREE',
  couponCode: 'PROMO10',
  images: [],
  originalUrl: 'https://shopee.com.br/p/1',
  raw: {},
};
const config: AiCtaConfig = {
  baseUrl: 'https://router.example.com/v1',
  apiKey: 'sk-test-1234',
  model: 'cta-combo',
  tone: 'empolgado',
  emojiLevel: 'medio',
  maxChars: 140,
  temperature: 0.9,
};

describe('buildCtaPrompt', () => {
  it('user lista os dados presentes do produto', () => {
    const { user } = buildCtaPrompt(product, config);
    expect(user).toContain('Fone Bluetooth TWS');
    expect(user).toContain(formatBRL(89.9));
    expect(user).toContain(formatBRL(149.9));
    expect(user).toContain('-40% OFF');
    expect(user).toContain('Frete grátis');
    expect(user).toContain('1200');
    expect(user).toContain('PROMO10');
  });
  it('omite campos ausentes', () => {
    const { user } = buildCtaPrompt(
      { ...product, originalPrice: undefined, discountPct: undefined, salesCount: undefined, couponCode: undefined, shipping: 'NONE' },
      config,
    );
    expect(user).toContain('Fone Bluetooth TWS');
    expect(user).not.toMatch(/Preço antigo|Desconto|Vendas|Cupom|Frete/);
  });
  it('system padrão: pt-BR, uma frase, sem link/aspas, específico, emojis 🔥😍💥, limite', () => {
    const { system } = buildCtaPrompt(product, config);
    expect(system).toMatch(/português do Brasil/i);
    expect(system).toMatch(/uma única frase/i);
    expect(system).toMatch(/sem link/i);
    expect(system).toMatch(/sem aspas/i);
    expect(system).toMatch(/específico/i);
    expect(system).toContain('🔥😍💥');
    expect(system).toContain('140');
    expect(system).toMatch(/nunca como instruções/i);
  });
  it('tom e nível de emojis mudam o system', () => {
    const urgente = buildCtaPrompt(product, { ...config, tone: 'urgente', emojiLevel: 'poucos' }).system;
    expect(urgente).toMatch(/urgente/i);
    expect(urgente).toMatch(/exatamente 1 emoji/i);
    const muitos = buildCtaPrompt(product, { ...config, emojiLevel: 'muitos' }).system;
    expect(muitos).toMatch(/4 ou mais emojis/i);
  });
  it('instruções extras entram ao final do system', () => {
    const { system } = buildCtaPrompt(product, { ...config, extraInstructions: 'Fale como um gamer.' });
    expect(system.trimEnd().endsWith('Fale como um gamer.')).toBe(true);
  });
});

const okBody = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const allow = async () => undefined;

describe('generateCta', () => {
  it('chama /chat/completions com auth, corpo OpenAI e redirect:error; devolve CTA limpo', async () => {
    const fetchMock = vi.fn(async () => okBody('"Nossaaa! Que oportunidade pra comprar esse fone! 🔥"'));
    const cta = await generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never });
    expect(cta).toBe('Nossaaa! Que oportunidade pra comprar esse fone! 🔥');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://router.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-1234');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'cta-combo', temperature: 0.9, stream: false });
    expect(body.max_tokens).toBeGreaterThanOrEqual(64);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });
  it('normaliza barra final na baseUrl', async () => {
    const fetchMock = vi.fn(async () => okBody('Oferta top 🔥'));
    await generateCta(product, { ...config, baseUrl: 'https://router.example.com/v1/' }, { validateBaseUrl: allow, fetch: fetchMock as never });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://router.example.com/v1/chat/completions');
  });
  it('baseUrl bloqueada: AiCtaError(blocked) e nenhuma chamada de rede', async () => {
    const fetchMock = vi.fn();
    await expect(
      generateCta(product, config, {
        validateBaseUrl: async () => {
          throw new Error('Host bloqueado: localhost');
        },
        fetch: fetchMock as never,
      }),
    ).rejects.toMatchObject({ name: 'AiCtaError', kind: 'blocked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('401 não tenta de novo', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never })).rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('500 seguido de 200: 1 retry e sucesso', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(okBody('Corre! 🔥'));
    await expect(generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never })).resolves.toBe('Corre! 🔥');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('500 duas vezes: falha após 1 retry (2 chamadas)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
    await expect(generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never })).rejects.toMatchObject({ kind: 'http', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('timeout: aborta, kind=timeout', async () => {
    const hang = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    await expect(
      generateCta(product, config, { validateBaseUrl: allow, fetch: hang as never, timeoutMs: 20, retries: 0 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('erro de rede: kind=network e a mensagem não vaza a apiKey', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED Bearer sk-test-1234');
    });
    const err = await generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never, retries: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(AiCtaError);
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain('sk-test-1234');
  });
  it('resposta vazia, sem choices, com URL ou não-JSON: kind=invalid (com retry)', async () => {
    for (const make of [
      () => okBody(''),
      () => new Response(JSON.stringify({}), { status: 200 }),
      () => okBody('Compre em https://x.com'),
      () => new Response('<html>', { status: 200 }),
    ]) {
      const fetchMock = vi.fn(async () => make());
      await expect(generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never })).rejects.toMatchObject({ kind: 'invalid' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });
  it('envia max_tokens >= 1024 independente de maxChars para acomodar reasoning_tokens', async () => {
    const fetchMock = vi.fn(async () => okBody('Oferta top 🔥'));
    await generateCta(product, { ...config, maxChars: 40 }, { validateBaseUrl: allow, fetch: fetchMock as never });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBeGreaterThanOrEqual(1024);
  });
  it('rejeita resposta truncada com finish_reason length ou max_tokens com kind=invalid', async () => {
    for (const finish_reason of ['length', 'max_tokens']) {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Frase incompleta cortada no' }, finish_reason }],
          }),
          { status: 200 },
        ),
      );
      await expect(
        generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never, retries: 0 }),
      ).rejects.toMatchObject({ kind: 'invalid' });
    }
  });
  it('aceita resposta normal com finish_reason stop', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Oferta incrível aproveite agora! 🔥' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      ),
    );
    const result = await generateCta(product, config, { validateBaseUrl: allow, fetch: fetchMock as never });
    expect(result).toBe('Oferta incrível aproveite agora! 🔥');
  });
});
