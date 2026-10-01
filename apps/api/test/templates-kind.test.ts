import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let couponId: string;

beforeAll(async () => {
  t = await createTenantWithUser('TemplatesKind');
  cookie = await loginCookie(app, t.email, t.password);
  couponId = (
    await prisma.coupon.create({
      data: {
        tenantId: t.tenantId,
        store: 'AMAZON',
        code: 'REAL15',
        description: '15% em eletrônicos',
        status: 'VALID',
        expiresAt: new Date('2030-12-31T12:00:00Z'),
      },
    })
  ).id;
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

const call = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, payload });

describe('templates com kind', () => {
  it('cria template de cupom e devolve kind', async () => {
    const r = await call('POST', '/templates', { name: 'Meu cupom', body: '{codigo}', kind: 'COUPON' });
    expect(r.statusCode).toBe(201);
    expect(r.json().kind).toBe('COUPON');
  });

  it('sem kind o template criado é PRODUCT', async () => {
    const r = await call('POST', '/templates', { name: 'Prod', body: '{titulo}' });
    expect(r.json().kind).toBe('PRODUCT');
  });

  it('PUT sem kind preserva o kind existente', async () => {
    const created = (await call('POST', '/templates', { name: 'Manter', body: '{codigo}', kind: 'COUPON' })).json();
    const r = await call('PUT', `/templates/${created.id}`, { name: 'Manter 2', body: '{codigo} {loja}' });
    expect(r.statusCode).toBe(200);
    expect(r.json().kind).toBe('COUPON');
    expect(r.json().name).toBe('Manter 2');
  });
});

describe('prévia de template de cupom', () => {
  it('sem couponId usa o cupom de exemplo', async () => {
    const r = await call('POST', '/templates/preview', {
      body: '{codigo} na {loja}',
      kind: 'COUPON',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().text).toBe('AFILIADO10 na SHOPEE');
  });

  it('com couponId usa o cupom cadastrado', async () => {
    const r = await call('POST', '/templates/preview', {
      body: '{codigo} - {descricao} - {validade}',
      kind: 'COUPON',
      couponId,
    });
    expect(r.json().text).toBe('REAL15 - 15% em eletrônicos - 31/12/2030');
  });

  it('couponId inexistente → 404', async () => {
    const r = await call('POST', '/templates/preview', { body: '{codigo}', kind: 'COUPON', couponId: 'nao-existe' });
    expect(r.statusCode).toBe(404);
  });

  it('sem kind continua renderizando como produto', async () => {
    const r = await call('POST', '/templates/preview', { body: '{titulo}' });
    expect(r.json().text.length).toBeGreaterThan(0);
  });
});

describe('POST /templates/coupon-example', () => {
  it('cria o exemplo uma única vez', async () => {
    const first = await call('POST', '/templates/coupon-example', {});
    expect(first.statusCode).toBe(201);
    expect(first.json().kind).toBe('COUPON');
    expect(first.json().body).toContain('{codigo}');
    const second = await call('POST', '/templates/coupon-example', {});
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(
      await prisma.template.count({ where: { tenantId: t.tenantId, name: 'Cupom (exemplo)' } }),
    ).toBe(1);
  });
});
