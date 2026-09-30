import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import type {
  GroupParticipantsUpdateEvent,
  GroupSnapshot,
  WhatsAppGateway,
} from '../src/wa/gateway';
import { GroupLinkMonitor } from '../src/group-links/monitor';
import type { GroupLinkRotateJob } from '@afilados/shared';

class FakeGateway implements Pick<
  WhatsAppGateway,
  'onGroupParticipants' | 'isConnected' | 'getGroupSnapshot'
> {
  private handler: ((e: GroupParticipantsUpdateEvent) => void) | null = null;
  public snapshots = new Map<string, GroupSnapshot>();

  onGroupParticipants(h: (e: GroupParticipantsUpdateEvent) => void) {
    this.handler = h;
  }

  isConnected(_sessionId: string) {
    return true;
  }

  async getGroupSnapshot(_sessionId: string, jid: string): Promise<GroupSnapshot> {
    const snap = this.snapshots.get(jid);
    if (!snap) throw new Error('GROUP_NOT_FOUND');
    return snap;
  }

  emit(e: GroupParticipantsUpdateEvent) {
    this.handler?.(e);
  }
}

let tenantId: string;
let sessionId: string;
let linkId: string;
let managedGroupId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: 'link-monitor-test' } });
  tenantId = tenant.id;

  const session = await prisma.waSession.create({
    data: { tenantId, label: 'monitor-sess', status: 'CONNECTED' },
  });
  sessionId = session.id;

  const link = await prisma.groupLink.create({
    data: {
      tenantId,
      sessionId,
      slug: `monitor-slug-${Date.now()}`,
      label: 'Link Monitor Test',
      baseName: 'Monitor VIP',
      memberLimit: 100,
      rotateMargin: 10, // rotateAt = 90
    },
  });
  linkId = link.id;

  const mg = await prisma.managedGroup.create({
    data: {
      tenantId,
      groupLinkId: linkId,
      sequence: 1,
      number: 1,
      jid: '123456@g.us',
      name: 'Monitor VIP #1',
      memberCount: 85,
      status: 'ACTIVE',
    },
  });
  managedGroupId = mg.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('GroupLinkMonitor', () => {
  it('carrega grupos ativos no cache e calcula rotateAt', async () => {
    const gateway = new FakeGateway();
    const monitor = new GroupLinkMonitor(gateway);
    await monitor.start();

    expect(monitor.groupCount()).toBeGreaterThanOrEqual(1);
    const entry = monitor.getGroupEntry(sessionId, '123456@g.us');
    expect(entry).toBeDefined();
    expect(entry?.rotateAt).toBe(90);
    expect(entry?.memberCount).toBe(85);

    monitor.stop();
  });

  it('atualiza contagem de membros em evento add e dispara rotação ao atingir o limite', async () => {
    const gateway = new FakeGateway();
    const enqueued: GroupLinkRotateJob[] = [];
    const queue = {
      add: async (_n: string, data: GroupLinkRotateJob) => {
        enqueued.push(data);
      },
    };
    const monitor = new GroupLinkMonitor(gateway, { queue: queue as never });
    await monitor.start();

    // Adiciona 10 membros -> vai de 85 para 95 (>= 90 rotateAt)
    gateway.emit({
      sessionId,
      jid: '123456@g.us',
      participants: [
        '551199990001',
        '551199990002',
        '551199990003',
        '551199990004',
        '551199990005',
        '551199990006',
        '551199990007',
        '551199990008',
        '551199990009',
        '551199990010',
      ],
      action: 'add',
    });

    // Aguarda atualização assíncrona
    await new Promise((r) => setTimeout(r, 100));

    const updated = await prisma.managedGroup.findFirst({ where: { id: managedGroupId } });
    expect(updated?.memberCount).toBe(95);
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]?.groupLinkId).toBe(linkId);
    expect(enqueued[0]?.reason).toBe('threshold');

    monitor.stop();
  });

  it('reconciliação periódica atualiza contagem absoluta e dados de convite', async () => {
    const gateway = new FakeGateway();
    gateway.snapshots.set('123456@g.us', {
      jid: '123456@g.us',
      subject: 'Monitor VIP #1',
      memberCount: 50,
      inviteCode: 'ABCDEFG',
    });

    const monitor = new GroupLinkMonitor(gateway);
    await monitor.start();
    await monitor.reconcileAll();

    const updated = await prisma.managedGroup.findFirst({ where: { id: managedGroupId } });
    expect(updated?.memberCount).toBe(50);
    expect(updated?.inviteLink).toBe('https://chat.whatsapp.com/ABCDEFG');

    monitor.stop();
  });
});
