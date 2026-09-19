import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import type { MirrorMessageJob } from '@afilados/shared';
import { mirrorMessage, type MirrorMessageDeps } from '../src/processors/mirror-message';
import type { WhatsAppGateway } from '../src/wa/gateway';

let tenantId: string;
let sessionId: string;
let templateId: string;

const { publishEvent } = vi.hoisted(() => ({
  publishEvent: vi.fn(async () => {}),
}));
vi.mock('../src/lib/events', () => ({ publishEvent }));

const fakeGateway = {
  isConnected: vi.fn(() => true),
  sendMessage: vi.fn(async () => ({ messageId: 'wa-msg-123' })),
  fetchGroups: vi.fn(async () => []),
  onMessage: vi.fn(),
  downloadMedia: vi.fn(async () => Buffer.from('fake-image-bytes')),
} satisfies WhatsAppGateway;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'mirror-proc-test' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id;
  const tmpl = await prisma.template.create({
    data: {
      tenantId,
      name: 'Tmpl',
      body: 'OFERTA: {{title}} por {{price}} {{link}}',
      isDefault: true,
    },
  });
  templateId = tmpl.id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'AMAZON',
      affiliateTag: 'minha-20',
      encryptedCredentials: encryptJson({ tag: 'minha-20' }),
      status: 'OK',
    },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  fakeGateway.sendMessage.mockClear();
  fakeGateway.downloadMedia.mockClear();
  publishEvent.mockClear();
});

describe('mirrorMessage processor', () => {
  it('mensagem sem link é descartada com no-links', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us', 't2@g.us'],
        enabled: true,
      },
    });
    const jobData: MirrorMessageJob = {
      tenantId,
      ruleId: rule.id,
      sessionId,
      sourceJid: 's@g.us',
      msgId: 'M-nolink',
      message: { message: { conversation: 'bom dia pessoal!' } },
    };
    const res = await mirrorMessage({ gateway: fakeGateway, sleep: async () => {} }, jobData);
    expect(res).toEqual({ outcome: 'discarded', reason: 'no-links' });
    expect(fakeGateway.sendMessage).not.toHaveBeenCalled();

    const logs = await prisma.mirrorLog.findMany({ where: { ruleId: rule.id } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ status: 'DISCARDED', reason: 'no-links' });
  });

  it('espelha link Amazon com conversão de tag em modo CLONE', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const jobData: MirrorMessageJob = {
      tenantId,
      ruleId: rule.id,
      sessionId,
      sourceJid: 's@g.us',
      msgId: 'M-amazon',
      message: { message: { conversation: 'Olha isso: https://www.amazon.com.br/dp/B0ABCDEF12' } },
    };
    const res = await mirrorMessage({ gateway: fakeGateway, sleep: async () => {} }, jobData);
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });
    expect(fakeGateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't1@g.us',
      expect.objectContaining({
        kind: 'text',
        text: 'Olha isso: https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20',
      }),
    );

    const log = await prisma.mirrorLog.findFirstOrThrow({
      where: { ruleId: rule.id, targetJid: 't1@g.us' },
    });
    expect(log).toMatchObject({
      status: 'MIRRORED',
      productKey: 'AMAZON:B0ABCDEF12',
      waMessageId: 'wa-msg-123',
    });
  });

  it('deduplica produto repetido dentro da janela de dedup', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us'],
        dedupHours: 12,
        enabled: true,
      },
    });
    const jobData: MirrorMessageJob = {
      tenantId,
      ruleId: rule.id,
      sessionId,
      sourceJid: 's@g.us',
      msgId: 'M-dup',
      message: { message: { conversation: 'https://www.amazon.com.br/dp/B0DUP12345' } },
    };
    const deps: MirrorMessageDeps = { gateway: fakeGateway, sleep: async () => {} };
    const r1 = await mirrorMessage(deps, jobData);
    expect(r1).toEqual({ outcome: 'mirrored', count: 1 });

    const r2 = await mirrorMessage(deps, { ...jobData, msgId: 'M-dup-2' });
    expect(r2).toEqual({ outcome: 'mirrored', count: 0 }); // descartado por dedup

    const logs = await prisma.mirrorLog.findMany({
      where: { ruleId: rule.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0]!.status).toBe('MIRRORED');
    expect(logs[1]!.status).toBe('DISCARDED');
    expect(logs[1]!.reason).toBe('duplicate');
  });

  it('regra TEMPLATE com link Amazon faz fallback para CLONE com template->clone', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us'],
        mode: 'TEMPLATE',
        templateId,
        enabled: true,
      },
    });
    const jobData: MirrorMessageJob = {
      tenantId,
      ruleId: rule.id,
      sessionId,
      sourceJid: 's@g.us',
      msgId: 'M-fallback',
      message: {
        message: { conversation: 'Amazon promo: https://www.amazon.com.br/dp/B0XYZ98765' },
      },
    };
    const res = await mirrorMessage({ gateway: fakeGateway, sleep: async () => {} }, jobData);
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });

    const log = await prisma.mirrorLog.findFirstOrThrow({
      where: { ruleId: rule.id, targetJid: 't1@g.us' },
    });
    expect(log.status).toBe('MIRRORED');
    expect(log.reason).toBe('template->clone');
  });
});
