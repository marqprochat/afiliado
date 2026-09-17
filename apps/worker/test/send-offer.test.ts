import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { createShopeeAdapter } from '@afilados/marketplaces';
import { sendOffer, type SendOfferDeps } from '../src/processors/send-offer';
import type { OutgoingMessage, WhatsAppGateway } from '../src/wa/gateway';
import { closeRedis } from '../src/lib/redis';

class FakeGateway implements WhatsAppGateway {
  sent: { jid: string; msg: OutgoingMessage }[] = [];
  failFor = new Set<string>();
  connected = true;
  isConnected() {
    return this.connected;
  }
  async sendMessage(_s: string, jid: string, msg: OutgoingMessage) {
    if (this.failFor.has(jid)) throw new Error('boom');
    this.sent.push({ jid, msg });
    return { messageId: `m-${this.sent.length}` };
  }
  async fetchGroups() {
    return [];
  }
  onMessage() {}
  async downloadMedia() {
    return Buffer.from('');
  }
}

let tenantId: string;
let sessionId: string;
let templateId: string;
let productId: string;
const gateway = new FakeGateway();
const deps: SendOfferDeps = {
  gateway,
  shopee: createShopeeAdapter({ mock: true }),
  now: () => new Date('2026-09-14T12:00:00-03:00'),
  sleep: async () => undefined,
  rng: () => 0.5,
  bucketFor: () => ({ take: async () => 0 }),
};

async function makeBatch(
  overrides: {
    mediaMode?: 'IMAGE' | 'PREVIEW';
    status?: 'SCHEDULED' | 'PAUSED';
    groups?: string[];
  } = {},
) {
  const batch = await prisma.batch.create({
    data: {
      tenantId,
      sessionId,
      templateId,
      name: 'b',
      groupJids: overrides.groups ?? ['g1@g.us', 'g2@g.us'],
      intervalMin: 1,
      mediaMode: overrides.mediaMode ?? 'IMAGE',
      status: overrides.status ?? 'SCHEDULED',
      items: { create: [{ productId, order: 0, runAt: new Date() }] },
    },
    include: { items: true },
  });
  return { batch, item: batch.items[0]! };
}

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'so' } })).id;
  sessionId = (
    await prisma.waSession.create({ data: { tenantId, label: 's', status: 'CONNECTED' } })
  ).id;
  templateId = (
    await prisma.template.create({
      data: { tenantId, name: 't', body: '*{titulo}* {preco}\n{link}' },
    })
  ).id;
  await prisma.operatingWindow.create({ data: { tenantId } });
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
    },
  });
  productId = (
    await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        externalId: '1',
        title: 'Fone',
        price: 99.9,
        images: ['https://img/x.jpg'],
        originalUrl: 'https://shopee.com.br/product/1/1',
        raw: {},
      },
    })
  ).id;
  await prisma.queueItem.create({ data: { tenantId, productId } });
});
beforeEach(() => {
  gateway.sent = [];
  gateway.failFor.clear();
});
afterAll(async () => {
  // BatchItem.productId é ON DELETE RESTRICT, então lotes (e seus itens, via
  // cascade de Batch) precisam ser removidos antes do Product cascatear do Tenant.
  await prisma.batch.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
  await closeRedis();
});

describe('sendOffer', () => {
  it('envia imagem+legenda para cada grupo, grava SendLog e conclui o lote', async () => {
    const { batch, item } = await makeBatch();
    const r = await sendOffer(deps, item.id);
    expect(r).toEqual({ outcome: 'sent', groups: 2 });
    expect(gateway.sent.map((s) => s.jid)).toEqual(['g1@g.us', 'g2@g.us']);
    const first = gateway.sent[0]!.msg;
    expect(first.kind).toBe('image');
    if (first.kind === 'image') {
      expect(first.imageUrl).toBe('https://img/x.jpg');
      expect(first.caption).toBe('*Fone* R$ 99,90\nhttps://s.shopee.com.br/MOCK123');
    }
    expect(await prisma.sendLog.count({ where: { batchItemId: item.id, status: 'SENT' } })).toBe(2);
    expect((await prisma.batchItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'SENT',
    );
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('DONE');
    expect((await prisma.queueItem.findFirstOrThrow({ where: { productId } })).status).toBe('SENT');
  });

  it('é idempotente: grupos já com SendLog não são reenviados', async () => {
    const { item } = await makeBatch();
    await prisma.sendLog.create({
      data: {
        tenantId,
        batchItemId: item.id,
        groupJid: 'g1@g.us',
        waMessageId: 'old',
        status: 'SENT',
      },
    });
    const r = await sendOffer(deps, item.id);
    expect(r).toEqual({ outcome: 'sent', groups: 1 });
    expect(gateway.sent.map((s) => s.jid)).toEqual(['g2@g.us']);
  });

  it('modo PREVIEW envia texto com metadados', async () => {
    const { item } = await makeBatch({ mediaMode: 'PREVIEW' });
    await sendOffer(deps, item.id);
    const m = gateway.sent[0]!.msg;
    expect(m.kind).toBe('preview');
    if (m.kind === 'preview') {
      expect(m.url).toBe('https://s.shopee.com.br/MOCK123');
      expect(m.title).toBe('Fone');
      expect(m.thumbnailUrl).toBe('https://img/x.jpg');
    }
  });

  it('lote pausado → skipped sem enviar', async () => {
    const { item } = await makeBatch({ status: 'PAUSED' });
    expect(await sendOffer(deps, item.id)).toEqual({
      outcome: 'skipped',
      reason: 'batch-inactive',
    });
    expect(gateway.sent).toHaveLength(0);
  });

  it('fora da janela → rescheduled para a próxima abertura', async () => {
    const { batch, item } = await makeBatch();
    const r = await sendOffer(
      { ...deps, now: () => new Date('2026-09-14T03:00:00-03:00') },
      item.id,
    );
    expect(r).toEqual({ outcome: 'rescheduled', runAt: new Date('2026-09-14T07:30:00-03:00') });
    expect(gateway.sent).toHaveLength(0);
    expect((await prisma.batchItem.findUniqueOrThrow({ where: { id: item.id } })).runAt).toEqual(
      new Date('2026-09-14T07:30:00-03:00'),
    );
    expect(
      (await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).estimatedEndAt,
    ).toEqual(new Date('2026-09-14T07:30:00-03:00'));
  });

  it('falha em um grupo grava ERROR e segue para o próximo; item fica SENT', async () => {
    const { item } = await makeBatch();
    gateway.failFor.add('g1@g.us');
    const r = await sendOffer(deps, item.id);
    expect(r).toEqual({ outcome: 'sent', groups: 1 });
    const logs = await prisma.sendLog.findMany({
      where: { batchItemId: item.id },
      orderBy: { groupJid: 'asc' },
    });
    expect(logs.map((l) => l.status)).toEqual(['ERROR', 'SENT']);
    expect(logs[0]!.error).toBe('boom');
  });

  it('todos os grupos falham → item ERROR', async () => {
    const { item } = await makeBatch();
    gateway.failFor.add('g1@g.us').add('g2@g.us');
    await sendOffer(deps, item.id);
    expect((await prisma.batchItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'ERROR',
    );
  });

  it('erro antes do envio (ex.: link de afiliado) marca item ERROR e conclui o lote', async () => {
    const { batch, item } = await makeBatch();
    const brokenDeps: SendOfferDeps = {
      ...deps,
      shopee: {
        ...deps.shopee,
        toAffiliateLink: async () => {
          throw new Error('shopee down');
        },
      },
    };
    await expect(sendOffer(brokenDeps, item.id)).rejects.toThrow(/shopee down/);
    const updated = await prisma.batchItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.status).toBe('ERROR');
    expect(updated.error).toBe('shopee down');
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('DONE');
  });

  it('envia mensagem de cupom sem produto associado', async () => {
    const couponTemplate = await prisma.template.create({
      data: { tenantId, name: 'cupom', body: '🎟️ {codigo} na {loja}: {descricao}', kind: 'COUPON' },
    });
    const coupon = await prisma.coupon.create({
      data: { tenantId, store: 'AMAZON', code: 'PROMO10', description: '10% off' },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId,
        templateId: couponTemplate.id,
        name: 'cupom-batch',
        groupJids: ['g1@g.us'],
        intervalMin: 60,
        items: { create: [{ order: 0, runAt: new Date(), couponId: coupon.id }] },
      },
      include: { items: true },
    });
    const itemId = batch.items[0]!.id;

    const r = await sendOffer(deps, itemId);
    expect(r).toEqual({ outcome: 'sent', groups: 1 });
    expect(gateway.sent.map((s) => s.jid)).toEqual(['g1@g.us']);
    const msg = gateway.sent[0]!.msg;
    expect(msg.kind).toBe('text');
    if (msg.kind === 'text') {
      expect(msg.text).toContain('PROMO10');
    }

    const updated = await prisma.batchItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(updated.status).toBe('SENT');
  });
});
