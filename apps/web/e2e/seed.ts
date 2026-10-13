import { hash } from '@node-rs/argon2';
import { prisma, encryptJson } from '@afilados/db';
import { spDayKey, spMidnight } from '@afilados/shared';

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
  await prisma.waGroup.upsert({
    where: { sessionId_jid: { sessionId: session.id, jid: 'e2e-dest@g.us' } },
    update: {},
    create: {
      tenantId: tenant.id,
      sessionId: session.id,
      jid: 'e2e-dest@g.us',
      name: 'Grupo E2E Destino',
      botIsAdmin: true,
      memberCount: 5,
    },
  });
  // limpa fila/lotes/espelhamentos de execuções anteriores
  await prisma.batch.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.queueItem.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.mirrorRule.deleteMany({ where: { tenantId: tenant.id } });
  // métricas do dashboard: recria a cada execução
  await prisma.groupMemberEvent.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.groupSnapshot.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.sendLog.deleteMany({ where: { tenantId: tenant.id } });
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  const moves: { action: 'JOIN' | 'ADDED' | 'LEAVE'; h: number; who: string }[] = [
    { action: 'JOIN', h: 2, who: 'e2e-a' },
    { action: 'JOIN', h: 26, who: 'e2e-b' },
    { action: 'ADDED', h: 50, who: 'e2e-c' },
    { action: 'LEAVE', h: 3, who: 'e2e-d' },
  ];
  await prisma.groupMemberEvent.createMany({
    data: moves.map((m) => ({
      tenantId: tenant.id,
      sessionId: session.id,
      groupJid: 'e2e@g.us',
      participantJid: `${m.who}@s.whatsapp.net`,
      action: m.action,
      occurredAt: hoursAgo(m.h),
      dedupeKey: `e2e-seed-${m.who}`,
    })),
  });
  await prisma.groupSnapshot.create({
    data: {
      tenantId: tenant.id,
      sessionId: session.id,
      groupJid: 'e2e@g.us',
      date: spMidnight(spDayKey(new Date())),
      memberCount: 3,
    },
  });
  await prisma.sendLog.createMany({
    data: [1, 2, 3, 4].map((h) => ({
      tenantId: tenant.id,
      groupJid: 'e2e@g.us',
      status: h === 4 ? ('ERROR' as const) : ('SENT' as const),
      error: h === 4 ? 'timeout' : null,
      sentAt: hoursAgo(h),
    })),
  });
}
main().finally(() => prisma.$disconnect());
