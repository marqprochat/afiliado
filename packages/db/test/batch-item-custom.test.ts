import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/index';

let tenantId: string | undefined;

afterAll(async () => {
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('BatchItem mensagem livre', () => {
  it('persiste customText e customImageUrl sem produto nem cupom', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'custom-msg' } });
    tenantId = tenant.id;
    const session = await prisma.waSession.create({
      data: { tenantId, label: 's', status: 'CONNECTED' },
    });
    const template = await prisma.template.create({
      data: { tenantId, name: 't', body: '{link}' },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId: session.id,
        templateId: template.id,
        name: 'manual',
        groupJids: ['g1@g.us'],
        intervalMin: 1,
        items: {
          create: [
            {
              order: 0,
              runAt: new Date(),
              customText: 'Aviso importante',
              customImageUrl: 'https://img.example/a.jpg',
            },
          ],
        },
      },
      include: { items: true },
    });
    const item = batch.items[0]!;
    expect(item.productId).toBeNull();
    expect(item.couponId).toBeNull();
    expect(item.customText).toBe('Aviso importante');
    expect(item.customImageUrl).toBe('https://img.example/a.jpg');
  });
});
