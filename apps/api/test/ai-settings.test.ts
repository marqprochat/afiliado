import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let otherCookie: string;
const KEY = 'sk-secret-1234';
const BASE = 'https://203.0.113.10/v1'; // TEST-NET-3: IP público para o guard, sem DNS

const req = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: object, c = cookie) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie: c }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  t = await createTenantWithUser();
  other = await createTenantWithUser('Outro');
  cookie = await loginCookie(app, t.email, t.password);
  otherCookie = await loginCookie(app, other.email, other.password);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

describe('settings/ai', () => {
  it('GET devolve os defaults sem chave', async () => {
    const res = await req('GET', '/settings/ai');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: false, baseUrl: '', model: '', hasApiKey: false, apiKeyHint: null,
      extraInstructions: '', tone: 'empolgado', emojiLevel: 'medio', maxChars: 140, temperature: 0.9,
    });
  });
  it('PUT enabled=true sem baseUrl/model/apiKey → 400', async () => {
    const res = await req('PUT', '/settings/ai', { enabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
  it('PUT rejeita baseUrl privada/localhost (SSRF) → 400', async () => {
    for (const baseUrl of ['http://127.0.0.1:20128/v1', 'http://localhost/v1', 'http://10.0.0.5/v1', 'file:///etc/passwd']) {
      const res = await req('PUT', '/settings/ai', { baseUrl });
      expect(res.statusCode).toBe(400);
    }
  });
  it('PUT salva; GET mascara a chave e ela nunca aparece nem em claro no banco', async () => {
    const put = await req('PUT', '/settings/ai', { enabled: true, baseUrl: BASE, model: 'combo', apiKey: KEY });
    expect(put.statusCode).toBe(200);
    const get = await req('GET', '/settings/ai');
    expect(get.json()).toMatchObject({ enabled: true, baseUrl: BASE, model: 'combo', hasApiKey: true, apiKeyHint: '••••1234' });
    expect(JSON.stringify(put.json())).not.toContain(KEY);
    expect(JSON.stringify(get.json())).not.toContain(KEY);
    const row = await prisma.setting.findFirstOrThrow({ where: { tenantId: t.tenantId, key: 'ai' } });
    expect(JSON.stringify(row.value)).not.toContain(KEY);
  });
  it('PUT parcial mantém a chave quando apiKey é omitida ou vazia', async () => {
    await req('PUT', '/settings/ai', { tone: 'urgente', apiKey: '' });
    const get = await req('GET', '/settings/ai');
    expect(get.json()).toMatchObject({ tone: 'urgente', hasApiKey: true, apiKeyHint: '••••1234', model: 'combo' });
  });
  it('PUT valida domínio dos opcionais → 400', async () => {
    expect((await req('PUT', '/settings/ai', { maxChars: 5 })).statusCode).toBe(400);
    expect((await req('PUT', '/settings/ai', { tone: 'agressivo' })).statusCode).toBe(400);
  });
  it('GET /settings não expõe a chave "ai"', async () => {
    const res = await req('GET', '/settings');
    expect(res.json()).not.toHaveProperty('ai');
  });
  it('isolamento por tenant', async () => {
    const res = await req('GET', '/settings/ai', undefined, otherCookie);
    expect(res.json()).toMatchObject({ enabled: false, hasApiKey: false });
  });
});

describe('POST settings/ai/test', () => {
  it('usa a chave salva, gera CTA com produto de exemplo e devolve latência', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'Nossaaa! Que fone! 🔥' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await req('POST', '/settings/ai/test', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().cta).toBe('Nossaaa! Que fone! 🔥');
    expect(typeof res.json().latencyMs).toBe('number');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
  });
  it('mescla rascunho (não salvo) sobre o salvo', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'Bora! 😍' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await req('POST', '/settings/ai/test', { model: 'rascunho', tone: 'divertido' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('rascunho');
    expect((await req('GET', '/settings/ai')).json().model).toBe('combo'); // não persistiu
  });
  it('com productId usa o produto real; id inexistente → 404', async () => {
    const product = await prisma.product.create({
      data: { tenantId: t.tenantId, source: 'SHOPEE', externalId: 'ai1', title: 'Cafeteira Elétrica 15 Xícaras', price: 129.9, images: [], originalUrl: 'https://shopee.com.br/p/ai1', raw: {} },
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'Café! 🔥' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect((await req('POST', '/settings/ai/test', { productId: product.id })).statusCode).toBe(200);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1].content).toContain('Cafeteira Elétrica 15 Xícaras');
    expect((await req('POST', '/settings/ai/test', { productId: 'nao-existe' })).statusCode).toBe(404);
  });
  it('falha da IA → 502 AI_ERROR sem vazar a chave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const res = await req('POST', '/settings/ai/test', {});
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('AI_ERROR');
    expect(res.body).not.toContain(KEY);
  });
  it('baseUrl de rascunho privada → 400 e nenhuma chamada de rede', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await req('POST', '/settings/ai/test', { baseUrl: 'http://127.0.0.1:20128/v1' });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sem configuração suficiente → 400', async () => {
    const res = await req('POST', '/settings/ai/test', {}, otherCookie);
    expect(res.statusCode).toBe(400);
  });
});
