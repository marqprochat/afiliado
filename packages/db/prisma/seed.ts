import { hash } from '@node-rs/argon2';
import { prisma } from '../src/index';

const DEFAULT_TEMPLATE = `🔥 *{titulo}*

{#preco_antigo}~De {preco_antigo}~{/preco_antigo}
💰 *Por {preco}* {desconto}
{#frete_gratis}{frete_gratis}{/frete_gratis}
{#cupom}🎟️ Cupom: *{cupom}*{/cupom}
{#oferta_relampago}{oferta_relampago}{/oferta_relampago}

👉 {link}`;

async function main() {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) throw new Error('Defina SEED_USER_EMAIL e SEED_USER_PASSWORD');

  const tenant =
    (await prisma.tenant.findFirst({ where: { name: 'default' } })) ??
    (await prisma.tenant.create({ data: { name: 'default' } }));

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      tenantId: tenant.id,
      email,
      name: 'Admin',
      role: 'OWNER',
      passwordHash: await hash(password),
    },
  });

  await prisma.operatingWindow.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id },
  });

  const hasDefault = await prisma.template.findFirst({
    where: { tenantId: tenant.id, isDefault: true },
  });
  if (!hasDefault) {
    await prisma.template.create({
      data: { tenantId: tenant.id, name: 'Padrão', body: DEFAULT_TEMPLATE, isDefault: true },
    });
  }

  const settings: Record<string, unknown> = {
    queueLimit: 500,
    globalRateLimitPerMin: 6,
    subIdPattern: '{yyyyMMdd}-{batchId}',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      update: {},
      create: { tenantId: tenant.id, key, value: value as object },
    });
  }
  console.log(`Seed ok: tenant=${tenant.id} user=${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
