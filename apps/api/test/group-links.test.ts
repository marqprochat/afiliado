import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QUEUE_GROUP_LINK_ROTATE, type GroupLinkRotateJob } from '@afilados/shared';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { getQueue, getRedis } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let otherCookie: string;
let sessionId: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  other = await createTenantWithUser('o');
  cookie = await loginCookie(app, t.email, t.password);
  otherCookie = await loginCookie(app, other.email, other.password);

  const session = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 'Session Principal', status: 'CONNECTED' },
  });
  sessionId = session.id;

  try {
    await getQueue(QUEUE_GROUP_LINK_ROTATE).drain();
  } catch {
    // ignore
  }
});

afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

describe('group-links API routes', () => {
  let createdLinkId: string;
  const uniqueSlug = `test-link-${Date.now()}`;

  it('valida disponibilidade de slug', async () => {
    const resAvailable = await app.inject({
      method: 'GET',
      url: `/api/v1/group-links/slug-available?slug=${uniqueSlug}`,
      headers: { cookie },
    });
    expect(resAvailable.statusCode).toBe(200);
    expect(resAvailable.json().available).toBe(true);

    const resReserved = await app.inject({
      method: 'GET',
      url: '/api/v1/group-links/slug-available?slug=login',
      headers: { cookie },
    });
    expect(resReserved.statusCode).toBe(200);
    expect(resReserved.json().available).toBe(false);
  });

  it('cria novo GroupLink e enfileira job inicial de rotação', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-links',
      headers: { cookie },
      payload: {
        sessionId,
        slug: uniqueSlug,
        label: 'Meu Link de Ofertas',
        baseName: 'Ofertas VIP',
        customText: '🔥 PROMO 🔥',
        textPosition: 'PREFIX',
        numberPrefix: '#',
        startNumber: 1,
        memberLimit: 500,
        rotateMargin: 20,
      },
    });

    expect(res.statusCode).toBe(201);
    const link = res.json();
    createdLinkId = link.id;
    expect(link.slug).toBe(uniqueSlug);
    expect(link.memberLimit).toBe(500);

    // Verifica que o slug agora é marcado como indisponível
    const resCheck = await app.inject({
      method: 'GET',
      url: `/api/v1/group-links/slug-available?slug=${uniqueSlug}`,
      headers: { cookie },
    });
    expect(resCheck.json().available).toBe(false);
  });

  it('bloqueia criação de slug duplicado com 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-links',
      headers: { cookie },
      payload: {
        sessionId,
        slug: uniqueSlug,
        label: 'Outro Link',
        baseName: 'Ofertas VIP',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('lista links do tenant e respeita isolamento multi-tenant', async () => {
    const resTenant = await app.inject({
      method: 'GET',
      url: '/api/v1/group-links',
      headers: { cookie },
    });
    expect(resTenant.statusCode).toBe(200);
    expect(resTenant.json().length).toBeGreaterThanOrEqual(1);

    const resOther = await app.inject({
      method: 'GET',
      url: '/api/v1/group-links',
      headers: { cookie: otherCookie },
    });
    expect(resOther.statusCode).toBe(200);
    expect(resOther.json().length).toBe(0);

    const resGetOther = await app.inject({
      method: 'GET',
      url: `/api/v1/group-links/${createdLinkId}`,
      headers: { cookie: otherCookie },
    });
    expect(resGetOther.statusCode).toBe(404);
  });

  it('atualiza configurações com PATCH e aceita groupImageBase64', async () => {
    const fakeBase64 = 'data:image/jpeg;base64,' + Buffer.from('img').toString('base64');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/group-links/${createdLinkId}`,
      headers: { cookie },
      payload: {
        label: 'Nome Atualizado',
        memberLimit: 800,
        groupImageBase64: fakeBase64,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe('Nome Atualizado');
    expect(res.json().memberLimit).toBe(800);
    expect(res.json().groupImageBase64).toBe(fakeBase64);
  });

  it('guarda 409: impede exclusão de sessão do WhatsApp com GroupLink vinculado', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/wa/sessions/${sessionId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
  });

  it('endpoint público resolve redirecionamento ou fallback/503', async () => {
    // Cria grupo ativo manualmente para testar o redirect público
    await prisma.managedGroup.create({
      data: {
        tenantId: t.tenantId,
        groupLinkId: createdLinkId,
        sequence: 1,
        number: 1,
        jid: 'active123@g.us',
        name: '🔥 PROMO 🔥 Ofertas VIP #1',
        inviteLink: 'https://chat.whatsapp.com/TESTPUBLICINVITE',
        status: 'ACTIVE',
      },
    });

    // Limpa cache Redis para o slug
    await getRedis().del(`grouplink:slug:${uniqueSlug}`);

    const resPublic = await app.inject({
      method: 'GET',
      url: `/api/v1/public/group-links/${uniqueSlug}`,
    });

    expect(resPublic.statusCode).toBe(200);
    expect(resPublic.json()).toMatchObject({
      ok: true,
      inviteLink: 'https://chat.whatsapp.com/TESTPUBLICINVITE',
    });

    // Rota pública para slug inexistente retorna 404
    const res404 = await app.inject({
      method: 'GET',
      url: '/api/v1/public/group-links/slug-que-nao-existe-xyz',
    });
    expect(res404.statusCode).toBe(404);
  });

  it('deleta GroupLink com DELETE', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/group-links/${createdLinkId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);

    const resGet = await app.inject({
      method: 'GET',
      url: `/api/v1/group-links/${createdLinkId}`,
      headers: { cookie },
    });
    expect(resGet.statusCode).toBe(404);
  });
});
