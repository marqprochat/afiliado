import { prisma } from './client';

export * from '@prisma/client';
export * from './crypto';
export * from './affiliate';
export * from './defaults';
export { prisma };

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
  'CouponCheck',
  'ScheduledMessage',
  'ApiToken',
  'AutomationRule',
  'AutomationLog',
  'AutomationQueueItem',
  'TelegramBot',
  'TelegramChat',
  'AwinCatalogProduct',
  'GroupLink',
  'ManagedGroup',
  'GroupMemberEvent',
  'GroupSnapshot',
  'LinkClickEvent',
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

/** Operações por chave única que não podem ser escopadas por tenant via `where` — são rejeitadas. */
const UNSAFE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);

/**
 * Client escopado por tenant: injeta `tenantId` em `where` de leituras/updateMany/deleteMany
 * e em `data` de create/createMany/upsert. Modelos sem tenantId (Session, BatchItem, WaAuthKey)
 * passam direto — são alcançados via relações já escopadas.
 *
 * Atenção: `findUnique`/`findUniqueOrThrow`/`update`/`delete` por chave única agora lançam erro
 * em vez de passar direto (o Prisma não aceita campos extras no where único, então não dá para
 * escopá-los por tenant). Sempre localize com `findFirst` escopado antes de mutar, e use
 * `updateMany`/`deleteMany` para a mutação.
 *
 * Limitação de tipos conhecida: o `$extends` do Prisma não estreita o tipo de entrada de
 * `create()`/`createMany()`/`upsert()` — o TypeScript ainda exige `tenantId`/`tenant` mesmo que
 * a extensão os injete em runtime. Até isso ser melhorado, quem chamar `create` (etc.) no client
 * escopado deve usar `// @ts-expect-error` no site da chamada ou passar `tenantId` explicitamente.
 */
export function forTenant(tenantId: string) {
  const scoped = prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          if (UNSAFE_OPS.has(operation)) {
            throw new Error(
              `forTenant: operação ${operation} em ${model} não é escopada por tenant; use findFirst/updateMany/deleteMany`,
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
  return scoped.$extends({ client: { $tenantId: tenantId } });
}
export type TenantClient = ReturnType<typeof forTenant>;
