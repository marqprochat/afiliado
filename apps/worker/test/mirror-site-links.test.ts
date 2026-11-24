import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import type { MirrorMessageJob } from '@afilados/shared';
import { mirrorMessage, type MirrorMessageDeps } from '../src/processors/mirror-message';
import type { PublishOfferFn } from '../src/lib/publish-offer';
import type { RewriteOfferLinksFn } from '../src/lib/rewrite-offer-links';
import type { WhatsAppGateway } from '../src/wa/gateway';

const { publishEvent } = vi.hoisted(() => ({ publishEvent: vi.fn(async () => {}) }));
vi.mock('../src/lib/events', () => ({ publishEvent }));

const gateway = {
  isConnected: vi.fn(() => true),
  sendMessage: vi.fn(async () => ({ messageId: 'wa-site' })),
  fetchGroups: vi.fn(async () => []),
  onMessage: vi.fn(),
  downloadMedia: vi.fn(async () => Buffer.from('')),
  createGroup: vi.fn(async () => ({ jid: 'new@g.us' })),
  updateGroupParticipants: vi.fn(async () => {}),
  updateGroupSettings: vi.fn(async () => {}),
  getInviteCode: vi.fn(async () => 'ABC'),
  getGroupDetails: vi.fn(async () => ({
    jid: 'g@g.us',
    subject: 'Grupo',
    description: null,
    announceOnly: false,
    inviteCode: null,
    participants: [],
  })),
  onGroupParticipants: vi.fn(),
  getGroupSnapshot: vi.fn(async (_s: string, jid: string) => ({
    jid,
    subject: 'Grupo',
    memberCount: 1,
    inviteCode: null,
  })),
  updateGroupPicture: vi.fn(async () => {}),
} satisfies WhatsAppGateway;

let tenantId: string;
let sessionId: string;
let templateId: string;

const baseDeps = (): MirrorMessageDeps => ({
  gateway,
  sleep: async () => {},
  now: () => new Date('2026-11-23T12:00:00-03:00'),
  bucketFor: () => ({ take: async () => 0 }),
  resolveShortLinks: async () => new Map(),
});

const job = (ruleId: string, msgId: string, text: string): MirrorMessageJob => ({
  tenantId,
  ruleId,
  sessionId,
  sourceJid: 's@g.us',
  msgId,
  message: { message: { conversation: text } },
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'mirror-site-links' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id;
  templateId = (
    await prisma.template.create({
      data: { tenantId, name: 'T', body: '{titulo} {link}', isDefault: true },
    })
  ).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AMAZON',
      affiliateTag: 'minha-20',
      encryptedCredentials: encryptJson({ tag: 'minha-20' }),
      status: 'OK',
    },
  });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'SHOPEE',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
      status: 'OK',
    },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('espelhamento com link do site', () => {
  it('CLONE: passa o texto convertido e os links originais para rewriteOfferLinks e envia o resultado', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t9@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const affiliate = 'https://www.amazon.com.br/dp/B0SITELNK1?tag=minha-20';
    const rewrite = vi.fn<RewriteOfferLinksFn>(async (_t, text) =>
      text.replace(affiliate, 'https://site.test/ofertas/livro-ab12'),
    );
    gateway.sendMessage.mockClear();
    const res = await mirrorMessage(
      { ...baseDeps(), rewriteOfferLinks: rewrite },
      job(rule.id, 'M-site-clone', 'Olha: https://www.amazon.com.br/dp/B0SITELNK1'),
    );
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });
    expect(rewrite).toHaveBeenCalledWith(
      tenantId,
      `Olha: ${affiliate}`,
      new Map([[affiliate, 'https://www.amazon.com.br/dp/B0SITELNK1']]),
    );
    expect(gateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't9@g.us',
      { kind: 'text', text: 'Olha: https://site.test/ofertas/livro-ab12' },
      { dedupeEcho: true },
    );
  });

  it('CLONE: rewriteOfferLinks com erro → envia o texto com os links de afiliado', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t7@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const affiliate = 'https://www.amazon.com.br/dp/B0SITELNK2?tag=minha-20';
    const rewrite = vi.fn<RewriteOfferLinksFn>(async () => {
      throw new Error('db fora');
    });
    gateway.sendMessage.mockClear();
    const res = await mirrorMessage(
      { ...baseDeps(), rewriteOfferLinks: rewrite },
      job(rule.id, 'M-site-clone-err', 'Olha: https://www.amazon.com.br/dp/B0SITELNK2'),
    );
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });
    expect(gateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't7@g.us',
      { kind: 'text', text: `Olha: ${affiliate}` },
      { dedupeEcho: true },
    );
  });

  it('TEMPLATE (Shopee): o template e a prévia levam a página do site', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t8@g.us'],
        mode: 'TEMPLATE',
        templateId,
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const publish = vi.fn<PublishOfferFn>(async () => 'https://site.test/ofertas/caixa-ab12');
    gateway.sendMessage.mockClear();
    const res = await mirrorMessage(
      {
        ...baseDeps(),
        publishOffer: publish,
        getAdapter: () =>
          ({
            toAffiliateLink: async () => 'https://s.shopee.com.br/AFF9',
            fetchByUrls: async (_c: unknown, urls: string[]) => [
              {
                source: 'SHOPEE',
                externalId: '99',
                title: 'Caixa de som',
                price: 50,
                images: ['https://img/s.jpg'],
                shipping: 'UNKNOWN',
                originalUrl: urls[0]!,
                raw: {},
              },
            ],
          }) as never,
      },
      job(rule.id, 'M-site-template', 'Promo https://shopee.com.br/product/10/99'),
    );
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });
    expect(publish).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ title: 'Caixa de som' }),
      'https://s.shopee.com.br/AFF9',
    );
    expect(gateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't8@g.us',
      expect.objectContaining({
        kind: 'preview',
        text: 'Caixa de som https://site.test/ofertas/caixa-ab12',
        url: 'https://site.test/ofertas/caixa-ab12',
      }),
      { dedupeEcho: true },
    );
  });
});
