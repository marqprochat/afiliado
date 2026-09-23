import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import type { IncomingGroupMessage, WhatsAppGateway } from '../src/wa/gateway';
import { MirrorListener } from '../src/mirror/listener';

class FakeGateway implements Pick<WhatsAppGateway, 'onMessage'> {
  private handler: ((m: IncomingGroupMessage) => void) | null = null;
  onMessage(h: (m: IncomingGroupMessage) => void) {
    this.handler = h;
  }
  emit(m: IncomingGroupMessage) {
    this.handler?.(m);
  }
}

let tenantId: string;
let sessionId: string;
let ruleId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'listener' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id;
  const rule = await prisma.mirrorRule.create({
    data: {
      tenantId,
      sessionId,
      sourceJids: ['src@g.us'],
      targetJids: ['dst@g.us'],
      enabled: true,
    },
  });
  ruleId = rule.id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('MirrorListener', () => {
  it('enfileira job só para mensagens de origem com regra ativa', async () => {
    const gateway = new FakeGateway();
    const added: unknown[] = [];
    const queue = {
      add: async (_n: string, data: unknown) => {
        added.push(data);
      },
    };
    const listener = new MirrorListener(gateway as unknown as WhatsAppGateway, {
      queue: queue as never,
    });
    await listener.start();
    expect(listener.ruleCount()).toBe(1);

    gateway.emit({
      sessionId,
      sourceJid: 'src@g.us',
      msgId: 'M1',
      message: { conversation: 'x' },
    });
    gateway.emit({
      sessionId,
      sourceJid: 'outro@g.us',
      msgId: 'M2',
      message: { conversation: 'y' },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(added).toEqual([
      {
        tenantId,
        ruleId,
        sessionId,
        sourceJid: 'src@g.us',
        msgId: 'M1',
        message: { conversation: 'x' },
      },
    ]);
  });

  it('jobId gerado não pode conter ":" (BullMQ rejeita Custom Id com um único ":")', async () => {
    const gateway = new FakeGateway();
    const opts: { jobId: string }[] = [];
    const queue = {
      add: async (_n: string, _data: unknown, o: { jobId: string }) => {
        opts.push(o);
      },
    };
    const listener = new MirrorListener(gateway as unknown as WhatsAppGateway, {
      queue: queue as never,
    });
    await listener.start();

    gateway.emit({
      sessionId,
      sourceJid: 'src@g.us',
      msgId: 'M1',
      message: { conversation: 'x' },
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(opts).toHaveLength(1);
    expect(opts[0]!.jobId).not.toContain(':');
  });

  it('regra desativada não é carregada; reload() atualiza o cache', async () => {
    await prisma.mirrorRule.updateMany({ where: { id: ruleId }, data: { enabled: false } });
    const gateway = new FakeGateway();
    const listener = new MirrorListener(gateway as unknown as WhatsAppGateway, {
      queue: { add: async () => {} } as never,
    });
    await listener.start();
    expect(listener.ruleCount()).toBe(0);
    await prisma.mirrorRule.updateMany({ where: { id: ruleId }, data: { enabled: true } });
    await listener.reload();
    expect(listener.ruleCount()).toBe(1);
  });
});
