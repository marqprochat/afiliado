import { prisma } from '@afilados/db';

/**
 * Tenant do dono da aplicação: o do superadmin mais antigo entre as contas raiz (sem conta-mãe).
 * É a única fonte desta regra: o site público (API), o link do site nas ofertas postadas (worker),
 * a chave `siteLinks` e a migração dela usam a mesma, para o link postado nunca dar 404.
 */
export async function resolveOwnerTenantId(db: Pick<typeof prisma, 'user'> = prisma): Promise<string | null> {
  const owner = await db.user.findFirst({
    where: { isSuperAdmin: true, tenant: { parentTenantId: null } },
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true },
  });
  return owner?.tenantId ?? null;
}
