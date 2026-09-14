import { hash } from '@node-rs/argon2';
import { prisma, encryptJson } from '@afilados/db';

const EMAIL = 'e2e@test.local';
const PASSWORD = 'e2e-senha-123';

async function main() {
  const tenant =
    (await prisma.tenant.findFirst({ where: { name: 'e2e' } })) ??
    (await prisma.tenant.create({ data: { name: 'e2e' } }));
  await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { tenantId: tenant.id, email: EMAIL, name: 'E2E', passwordHash: await hash(PASSWORD) },
  });
  await prisma.operatingWindow.upsert({
    where: { tenantId: tenant.id },
    update: { startTime: '00:00', endTime: '23:59' },
    create: { tenantId: tenant.id, startTime: '00:00', endTime: '23:59' },
  });
  if (!(await prisma.template.findFirst({ where: { tenantId: tenant.id } }))) {
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        name: 'Padrão',
        body: '*{titulo}*\n{preco}\n{link}',
        isDefault: true,
      },
    });
  }
  await prisma.marketplaceConnection.upsert({
    where: { tenantId_kind: { tenantId: tenant.id, kind: 'SHOPEE' } },
    update: { status: 'OK' },
    create: {
      tenantId: tenant.id,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
    },
  });
  const session =
    (await prisma.waSession.findFirst({ where: { tenantId: tenant.id, label: 'E2E' } })) ??
    (await prisma.waSession.create({
      data: { tenantId: tenant.id, label: 'E2E', status: 'CONNECTED', phone: '5511999990000' },
    }));
  await prisma.waSession.update({ where: { id: session.id }, data: { status: 'CONNECTED' } });
  await prisma.waGroup.upsert({
    where: { sessionId_jid: { sessionId: session.id, jid: 'e2e@g.us' } },
    update: {},
    create: {
      tenantId: tenant.id,
      sessionId: session.id,
      jid: 'e2e@g.us',
      name: 'Grupo E2E',
      botIsAdmin: true,
      memberCount: 3,
    },
  });
  // limpa fila/lotes de execuções anteriores
  await prisma.batch.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.queueItem.deleteMany({ where: { tenantId: tenant.id } });
}
main().finally(() => prisma.$disconnect());
