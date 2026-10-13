import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { getRedis } from '../src/lib/redis';
import { recordLinkClick } from '../src/lib/link-clicks';
import { createTenantWithUser, cleanupTenant } from './helpers';

const app = await buildApp({ logger: false });
const slug = `clk-${Date.now()}`;
const fbSlug = `clkfb-${Date.now()}`;
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let linkId: string;
let fallbackLinkId: string;

beforeAll(async () => {
  t = await createTenantWithUser('clicks');
  const session = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 's', status: 'CONNECTED' },
  });
  const link = await prisma.groupLink.create({
    data: { tenantId: t.tenantId, sessionId: session.id, slug, label: 'L', baseName: 'Grupo' },
  });
  linkId = link.id;
  await prisma.managedGroup.create({
    data: {
      tenantId: t.tenantId,
      groupLinkId: link.id,
      sequence: 1,
      number: 1,
      jid: 'clk-active@g.us',
      name: 'Grupo #1',
      inviteLink: 'https://chat.whatsapp.com/CLKTEST',
      status: 'ACTIVE',
    },
  });
  fallbackLinkId = (
    await prisma.groupLink.create({
      data: {
        tenantId: t.tenantId,
        sessionId: session.id,
        slug: fbSlug,
        label: 'F',
        baseName: 'F',
        enabled: false,
        fallbackUrl: 'https://example.com/fallback',
      },
    })
  ).id;
  await getRedis().del(`grouplink:slug:${slug}`, `grouplink:slug:${fbSlug}`);
});

afterAll(async () => {
  await getRedis().del(`grouplink:slug:${slug}`, `grouplink:slug:${fbSlug}`);
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('cliques em links de grupo', () => {
  it('grava LinkClickEvent e incrementa clickCount, inclusive com resposta do cache', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/public/group-links/${slug}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ ok: true, inviteLink: 'https://chat.whatsapp.com/CLKTEST' });
      expect(body).not.toHaveProperty('click');
    }
    const events = await prisma.linkClickEvent.findMany({ where: { groupLinkId: linkId } });
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e).toMatchObject({ tenantId: t.tenantId, slug, targetGroupJid: 'clk-active@g.us' });
    }
    const link = await prisma.groupLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.clickCount).toBe(2);
  });

  it('registra o clique no fallback com targetGroupJid nulo', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/group-links/${fbSlug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fallbackUrl: 'https://example.com/fallback' });
    const events = await prisma.linkClickEvent.findMany({ where: { groupLinkId: fallbackLinkId } });
    expect(events).toHaveLength(1);
    expect(events[0]!.targetGroupJid).toBeNull();
  });

  it('slug inexistente não grava nada', async () => {
    const before = await prisma.linkClickEvent.count({ where: { tenantId: t.tenantId } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/group-links/nao-existe-clk',
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.linkClickEvent.count({ where: { tenantId: t.tenantId } })).toBe(before);
  });

  it('recordLinkClick não lança quando o link não existe', async () => {
    await expect(
      recordLinkClick({
        tenantId: t.tenantId,
        groupLinkId: 'nao-existe',
        slug: 'x',
        targetGroupJid: null,
      }),
    ).resolves.toBe(false);
  });
});
