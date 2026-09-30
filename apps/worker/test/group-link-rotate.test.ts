import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Job } from 'bullmq';
import { prisma } from '@afilados/db';
import type {
  WhatsAppGateway,
  GroupDetails,
  GroupInfo,
  OutgoingMessage,
  GroupSnapshot,
} from '../src/wa/gateway';
import { createGroupLinkRotateProcessor } from '../src/processors/group-link-rotate';
import type { GroupLinkRotateJob } from '@afilados/shared';

class FakeRotateGateway implements WhatsAppGateway {
  public createdGroups: { subject: string; participants: string[] }[] = [];
  public connected = true;

  isConnected(_sessionId: string): boolean {
    return this.connected;
  }
  async sendMessage(
    _sessionId: string,
    _jid: string,
    _msg: OutgoingMessage,
  ): Promise<{ messageId: string }> {
    return { messageId: 'm1' };
  }
  async fetchGroups(_sessionId: string): Promise<GroupInfo[]> {
    return [];
  }
  onMessage(): void {}
  onGroupParticipants(): void {}
  async downloadMedia(): Promise<Buffer> {
    return Buffer.from('');
  }
  async createGroup(
    _sessionId: string,
    subject: string,
    participantPhones: string[],
  ): Promise<{ jid: string }> {
    this.createdGroups.push({ subject, participants: participantPhones });
    return { jid: `group-${Date.now()}@g.us` };
  }
  async updateGroupParticipants(): Promise<void> {}
  async updateGroupSettings(): Promise<void> {}
  async getInviteCode(_sessionId: string, _jid: string): Promise<string> {
    return 'TESTINVITECODE';
  }
  async getGroupDetails(_sessionId: string, jid: string): Promise<GroupDetails> {
    return {
      jid,
      subject: 'Test',
      description: null,
      announceOnly: false,
      inviteCode: 'TESTINVITECODE',
      participants: [],
    };
  }
  async getGroupSnapshot(_sessionId: string, jid: string): Promise<GroupSnapshot> {
    return {
      jid,
      subject: 'Test',
      memberCount: 1,
      inviteCode: 'TESTINVITECODE',
    };
  }
  public updatedPictures: { jid: string; image: Buffer }[] = [];
  async updateGroupPicture(_sessionId: string, jid: string, image: Buffer): Promise<void> {
    this.updatedPictures.push({ jid, image });
  }
}

let tenantId: string;
let sessionId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: 'rotate-test' } });
  tenantId = tenant.id;

  const session = await prisma.waSession.create({
    data: { tenantId, label: 'rotate-sess', status: 'CONNECTED' },
  });
  sessionId = session.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('createGroupLinkRotateProcessor', () => {
  it('rotaciona grupo com sucesso, atualizando ACTIVE anterior para FULL e ativando novo', async () => {
    const link = await prisma.groupLink.create({
      data: {
        tenantId,
        sessionId,
        slug: `rotate-slug-${Date.now()}`,
        label: 'Link Rotação',
        baseName: 'Ofertas Top',
        startNumber: 1,
        nextSequence: 1,
      },
    });

    const gateway = new FakeRotateGateway();
    const processor = createGroupLinkRotateProcessor({ gateway });

    const job = {
      data: {
        tenantId,
        groupLinkId: link.id,
        fromGroupId: null,
        reason: 'initial',
      } as GroupLinkRotateJob,
    } as Job<GroupLinkRotateJob>;

    const result = await processor(job);
    expect(result.ok).toBe(true);

    const updatedLink = await prisma.groupLink.findFirst({ where: { id: link.id } });
    expect(updatedLink?.nextSequence).toBe(2);

    const activeGroup = await prisma.managedGroup.findFirst({
      where: { groupLinkId: link.id, status: 'ACTIVE' },
    });
    expect(activeGroup).toBeDefined();
    expect(activeGroup?.sequence).toBe(1);
    expect(activeGroup?.inviteLink).toBe('https://chat.whatsapp.com/TESTINVITECODE');
    expect(activeGroup?.name).toBe('Ofertas Top #1');

    // Agora dispara segunda rotação (com fromGroupId = activeGroup.id)
    const job2 = {
      data: {
        tenantId,
        groupLinkId: link.id,
        fromGroupId: activeGroup!.id,
        reason: 'threshold',
      } as GroupLinkRotateJob,
    } as Job<GroupLinkRotateJob>;

    const result2 = await processor(job2);
    expect(result2.ok).toBe(true);

    const prevGroup = await prisma.managedGroup.findFirst({ where: { id: activeGroup!.id } });
    expect(prevGroup?.status).toBe('FULL');

    const newActive = await prisma.managedGroup.findFirst({
      where: { groupLinkId: link.id, status: 'ACTIVE' },
    });
    expect(newActive?.sequence).toBe(2);
    expect(newActive?.name).toBe('Ofertas Top #2');
  });

  it('idempotência: não re-rotaciona se o grupo ativo já mudou', async () => {
    const link = await prisma.groupLink.create({
      data: {
        tenantId,
        sessionId,
        slug: `idempotent-slug-${Date.now()}`,
        label: 'Idempotent Link',
        baseName: 'Promo',
        startNumber: 1,
        nextSequence: 2,
      },
    });

    // Grupo ativo atual é sequence 2
    await prisma.managedGroup.create({
      data: {
        tenantId,
        groupLinkId: link.id,
        sequence: 2,
        number: 2,
        jid: 'group2@g.us',
        name: 'Promo #2',
        status: 'ACTIVE',
      },
    });

    const gateway = new FakeRotateGateway();
    const processor = createGroupLinkRotateProcessor({ gateway });

    // Job antigo quer rotacionar a partir do grupo 1 (que não é o ativo)
    const job = {
      data: {
        tenantId,
        groupLinkId: link.id,
        fromGroupId: 'cuid-do-grupo-1-antigo',
        reason: 'threshold',
      } as GroupLinkRotateJob,
    } as Job<GroupLinkRotateJob>;

    const result = await processor(job);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('ALREADY_ROTATED');
  });

  it('atualiza a foto de perfil do grupo quando groupImageBase64 está definido', async () => {
    const rawImage = Buffer.from('fake-jpeg-binary-data');
    const base64Data = `data:image/jpeg;base64,${rawImage.toString('base64')}`;

    const link = await prisma.groupLink.create({
      data: {
        tenantId,
        sessionId,
        slug: `image-slug-${Date.now()}`,
        label: 'Link Imagem',
        baseName: 'Grupo com Foto',
        startNumber: 1,
        nextSequence: 1,
        groupImageBase64: base64Data,
      },
    });

    const gateway = new FakeRotateGateway();
    const processor = createGroupLinkRotateProcessor({ gateway });

    const job = {
      data: {
        tenantId,
        groupLinkId: link.id,
        fromGroupId: null,
        reason: 'initial',
      } as GroupLinkRotateJob,
    } as Job<GroupLinkRotateJob>;

    const result = await processor(job);
    expect(result.ok).toBe(true);
    expect(gateway.updatedPictures.length).toBe(1);
    expect(gateway.updatedPictures[0]?.image.toString()).toBe(rawImage.toString());
  });
});
