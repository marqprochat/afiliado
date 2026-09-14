import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Modelos que possuem coluna tenantId e devem ser filtrados automaticamente. */
const TENANT_MODELS = new Set([
  'User',
  'WaSession',
  'WaGroup',
  'MarketplaceConnection',
  'Product',
  'QueueItem',
  'Template',
  'Batch',
  'SendLog',
  'Setting',
  'Subscription',
  'MirrorRule',
  'Coupon',
  'ScheduledMessage',
]);

const FILTERED_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'updateMany',
  'deleteMany',
  'aggregate',
  'groupBy',
]);

/**
 * Client escopado por tenant: injeta `tenantId` em `where` de leituras/updateMany/deleteMany
 * e em `data` de create/createMany/upsert. Modelos sem tenantId (Session, BatchItem, WaAuthKey)
 * passam direto — são alcançados via relações já escopadas.
 *
 * Atenção: `findUnique`/`update`/`delete` por chave única NÃO são filtrados (o Prisma não aceita
 * campos extras no where único). Sempre localize com `findFirst` escopado antes de mutar por id.
 */
export function forTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = args as {
            where?: Record<string, unknown>;
            data?: Record<string, unknown> | Record<string, unknown>[];
            create?: Record<string, unknown>;
          };
          if (FILTERED_OPS.has(operation)) a.where = { ...(a.where ?? {}), tenantId };
          if (operation === 'create' && a.data && !Array.isArray(a.data)) a.data = { ...a.data, tenantId };
          if (operation === 'createMany' && Array.isArray(a.data)) {
            a.data = a.data.map((d) => ({ ...d, tenantId }));
          }
          if (operation === 'upsert' && a.create) a.create = { ...a.create, tenantId };
          return query(args);
        },
      },
    },
  });
}
export type TenantClient = ReturnType<typeof forTenant>;
