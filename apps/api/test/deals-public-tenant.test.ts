import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let other: Awaited<ReturnType<typeof createTenantWithUser>> | undefined;
let owner: Awaited<ReturnType<typeof createTenantWithUser>> | undefined;
let affiliate: Awaited<ReturnType<typeof createTenantWithUser>> | undefined;
let demotedSuperAdminIds: string[] = [];
let otherCookie = '';
let affiliateCookie = '';

const OWNER_SLUG = 'produto-do-dono-0001';
const OTHER_SLUG = 'produto-do-outro-0001';

const master = (tenantId: string, slug: string) =>
  prisma.masterProduct.create({
    data: {
      tenantId,
      title: slug,
      cleanTitle: slug,
      slug,
      lowestPriceEver: 10,
      averagePrice30d: 10,
      currentBestPrice: 10,
    },
  });

beforeAll(async () => {
  // O banco compartilhado de testes é semeado com um superadmin: rebaixa-o durante o teste e
  // restaura no afterAll (os testes deste pacote rodam em série). Os ids são guardados ANTES de
  // alterar qualquer coisa, para o afterAll restaurar mesmo se o setup falhar no meio.
  demotedSuperAdminIds = (
    await prisma.user.findMany({ where: { isSuperAdmin: true }, select: { id: true } })
  ).map((u) => u.id);
  if (demotedSuperAdminIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: demotedSuperAdminIds } },
      data: { isSuperAdmin: false },
    });
  }
  // O tenant sem superadmin é criado ANTES: o fallback antigo ("primeiro tenant com MasterProduct")
  // tenderia a escolhê-lo.
  other = await createTenantWithUser('Outro com vitrine');
  await master(other.tenantId, OTHER_SLUG);
  owner = await createTenantWithUser('Dono');
  await prisma.user.update({ where: { id: owner.userId }, data: { isSuperAdmin: true } });
  await master(owner.tenantId, OWNER_SLUG);
  affiliate = await createTenantWithUser('Afiliado do dono', owner.tenantId);
  otherCookie = await loginCookie(app, other.email, other.password);
  affiliateCookie = await loginCookie(app, affiliate.email, affiliate.password);
});

afterAll(async () => {
  try {
    if (demotedSuperAdminIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: demotedSuperAdminIds } },
        data: { isSuperAdmin: true },
      });
    }
  } finally {
    try {
      // O afiliado é filho do dono: cleanupTenant(owner) o remove junto.
      if (other) await cleanupTenant(other.tenantId);
      if (owner) await cleanupTenant(owner.tenantId);
    } finally {
      await app.close();
    }
  }
});

const get = (url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });

describe('rotas públicas de /deals servem sempre o tenant do dono', () => {
  it('anônimo: serve as ofertas do tenant do superadmin', async () => {
    expect((await get(`/api/v1/deals/${OWNER_SLUG}`)).statusCode).toBe(200);
    expect((await get(`/api/v1/deals/${OTHER_SLUG}`)).statusCode).toBe(404);
  });

  it('logado em outro tenant: o link do site do dono continua abrindo (200)', async () => {
    expect((await get(`/api/v1/deals/${OWNER_SLUG}`, otherCookie)).statusCode).toBe(200);
    expect((await get(`/api/v1/deals/${OTHER_SLUG}`, otherCookie)).statusCode).toBe(404);
  });

  it('logado como afiliado: o link do site do dono continua abrindo (200)', async () => {
    expect((await get(`/api/v1/deals/${OWNER_SLUG}`, affiliateCookie)).statusCode).toBe(200);
  });

  it('a vitrine de quem está logado em outro tenant é a do dono', async () => {
    const res = await get('/api/v1/deals?limit=50', otherCookie);
    expect(res.statusCode).toBe(200);
    const slugs = (res.json() as { deals: { slug: string }[] }).deals.map((d) => d.slug);
    expect(slugs).not.toContain(OTHER_SLUG);
  });

  it('alerta de preço de quem está logado em outro tenant vai para o produto do dono', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${OWNER_SLUG}/alerts`,
      headers: { cookie: otherCookie },
      payload: { recipient: 'dono-alerta@test.local', channel: 'EMAIL', notifyOnAnyDrop: true },
    });
    expect(res.statusCode).toBeLessThan(300);
  });
});
