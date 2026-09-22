import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export * from './crypto';

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
  'OperatingWindow',
  'Batch',
  'SendLog',
  'Setting',
  'Subscription',
  'MirrorRule',
  'MirrorLog',
  'Coupon',
  'ScheduledMessage',
  'ApiToken',
  'AutomationRule',
  'AutomationLog',
  'AutomationQueueItem',
  'TelegramBot',
  'TelegramChat',
  'AwinCatalogProduct',
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

/** OperaÃ§Ãµes por chave Ãºnica que nÃ£o podem ser escopadas por tenant via `where` â€” sÃ£o rejeitadas. */
const UNSAFE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);

/**
 * Client escopado por tenant: injeta `tenantId` em `where` de leituras/updateMany/deleteMany
 * e em `data` de create/createMany/upsert. Modelos sem tenantId (Session, BatchItem, WaAuthKey)
 * passam direto â€” sÃ£o alcanÃ§ados via relaÃ§Ãµes jÃ¡ escopadas.
 *
 * AtenÃ§Ã£o: `findUnique`/`findUniqueOrThrow`/`update`/`delete` por chave Ãºnica agora lanÃ§am erro
 * em vez de passar direto (o Prisma nÃ£o aceita campos extras no where Ãºnico, entÃ£o nÃ£o dÃ¡ para
 * escopÃ¡-los por tenant). Sempre localize com `findFirst` escopado antes de mutar, e use
 * `updateMany`/`deleteMany` para a mutaÃ§Ã£o.
 *
 * LimitaÃ§Ã£o de tipos conhecida: o `$extends` do Prisma nÃ£o estreita o tipo de entrada de
 * `create()`/`createMany()`/`upsert()` â€” o TypeScript ainda exige `tenantId`/`tenant` mesmo que
 * a extensÃ£o os injete em runtime. AtÃ© isso ser melhorado, quem chamar `create` (etc.) no client
 * escopado deve usar `// @ts-expect-error` no site da chamada ou passar `tenantId` explicitamente.
 */
export function forTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          if (UNSAFE_OPS.has(operation)) {
            throw new Error(
              `forTenant: operaÃ§Ã£o ${operation} em ${model} nÃ£o Ã© escopada por tenant; use findFirst/updateMany/deleteMany`,
            );
          }
          const a = args as {
            where?: Record<string, unknown>;
            data?: Record<string, unknown> | Record<string, unknown>[];
            create?: Record<string, unknown>;
          };
          if (FILTERED_OPS.has(operation)) a.where = { ...(a.where ?? {}), tenantId };
          if (operation === 'create' && a.data && !Array.isArray(a.data))
            a.data = { ...a.data, tenantId };
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

