# Afiliados (SaaS sem pagamento) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O SuperAdmin cria contas de afiliado (tenants filhos) que usam as credenciais de marketplace e de IA do SuperAdmin, cadastrando só um identificador (SubID/tracking ID/etiqueta/loja) por plataforma.

**Architecture:** `Tenant.parentTenantId` liga o afiliado ao tenant do SuperAdmin. Um resolvedor único em `@afilados/db` devolve credenciais do pai e `subId` do próprio afiliado; API e worker passam a usar só ele. O SuperAdmin gerencia afiliados em `/api/v1/admin/*` e "entra como" o afiliado por uma sessão marcada com `impersonatorUserId`.

**Tech Stack:** pnpm monorepo, Prisma/Postgres, Fastify, BullMQ, Next.js, Vitest.

## Global Constraints

Spec: `docs/superpowers/specs/2026-10-16-afiliados-saas-design.md`.

- Comissão sempre na conta do SuperAdmin; o identificador do afiliado só separa a atribuição.
- Afiliado não grava credenciais de marketplace nem chave/URL/modelo de IA (403).
- Busca, produtos, fila, lotes, automações, cupons, WhatsApp, grupos, Telegram e token da extensão continuam isolados por tenant.
- Controle: apenas ativar/desativar. Exclusão de afiliado fora do escopo.
- SubID Shopee/AliExpress/Awin: só `[A-Za-z0-9]`, máx. 50. Shopee envia `subIds: [afiliado, padrão data/lote]`; AliExpress `sub_id`; Awin `clickref`.
- Amazon/ML/Magalu: `tag` das credenciais é substituída pelo identificador do afiliado; vazio → tag do SuperAdmin.
- Tenant sem pai (raiz) mantém exatamente o comportamento atual.
- Testes de integração: `set -a && . ./.env && set +a && pnpm vitest run <arquivo>` (Postgres/Redis do compose no ar).
- Commits sem pular hooks; mensagens em português no estilo `feat(afiliados): ...`.

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/db/prisma/schema.prisma` + migração | `parentTenantId`, `active`, `isSuperAdmin`, `subId`, `impersonatorUserId` |
| `packages/db/src/client.ts` | instância `prisma` (separada para evitar import circular) |
| `packages/db/src/affiliate.ts` | `resolveConnection(s)`, `resolveSettings`, `mergeAffiliateAi`, `isTenantActive`, `listTenantsWithCredentials` |
| `packages/db/src/defaults.ts` | `DEFAULT_TEMPLATE`, `DEFAULT_SETTINGS` (usados por seed e criação de afiliado) |
| `packages/core/src/subid.ts` | `sanitizeSubId`, `composeLinkSubIds`, `applyAffiliateTag` |
| `packages/shared/src/affiliates.ts` | schemas Zod de afiliado |
| `apps/api/src/routes/admin-affiliates.ts` | CRUD, ativar, senha, entrar como, voltar |
| `apps/api/src/lib/session.ts`, `plugins/auth.ts` | sessão com impersonação, `isAffiliate`, guards |
| `apps/web/src/components/affiliates/*` | painel do SuperAdmin |
| `apps/web/src/components/marketplaces/affiliate-marketplaces.tsx` | tela de SubIDs do afiliado |

---

### Task 1: Schema, migração e seed

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (models `Tenant`, `User`, `Session`, `MarketplaceConnection`)
- Create: `packages/db/prisma/migrations/<timestamp>_affiliates/migration.sql` (gerada)
- Modify: `packages/db/prisma/seed.ts`
- Test: `packages/db/test/affiliate-schema.test.ts`

**Interfaces:**
- Produces: `Tenant.parentTenantId: string | null`, `Tenant.active: boolean`, `User.isSuperAdmin: boolean`, `MarketplaceConnection.subId: string | null`, `Session.impersonatorUserId: string | null`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// packages/db/test/affiliate-schema.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/index';

const tenantIds: string[] = [];
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds }, parentTenantId: { not: null } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('schema de afiliados', () => {
  it('tenant nasce ativo e sem pai; afiliado aponta para o pai', async () => {
    const parent = await prisma.tenant.create({ data: { name: 'aff-parent' } });
    const child = await prisma.tenant.create({
      data: { name: 'aff-child', parentTenantId: parent.id },
    });
    tenantIds.push(parent.id, child.id);
    expect(parent.active).toBe(true);
    expect(parent.parentTenantId).toBeNull();
    expect(child.parentTenantId).toBe(parent.id);
  });

  it('não exclui o tenant pai enquanto houver afiliado', async () => {
    const parent = await prisma.tenant.create({ data: { name: 'aff-parent2' } });
    const child = await prisma.tenant.create({
      data: { name: 'aff-child2', parentTenantId: parent.id },
    });
    tenantIds.push(parent.id, child.id);
    await expect(prisma.tenant.delete({ where: { id: parent.id } })).rejects.toThrow();
  });

  it('User.isSuperAdmin nasce false; subId é opcional; Session guarda impersonatorUserId', async () => {
    const t = await prisma.tenant.create({ data: { name: 'aff-user' } });
    tenantIds.push(t.id);
    const u = await prisma.user.create({
      data: { tenantId: t.id, email: `${t.id}@t.local`, name: 'U', passwordHash: 'x' },
    });
    expect(u.isSuperAdmin).toBe(false);
    const c = await prisma.marketplaceConnection.create({
      data: { tenantId: t.id, kind: 'SHOPEE', subId: 'joao' },
    });
    expect(c.subId).toBe('joao');
    const s = await prisma.session.create({
      data: { id: `s-${t.id}`, userId: u.id, expiresAt: new Date(Date.now() + 1000), impersonatorUserId: u.id },
    });
    expect(s.impersonatorUserId).toBe(u.id);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run packages/db/test/affiliate-schema.test.ts`
Expected: FAIL (campos inexistentes no Prisma Client).

- [ ] **Step 3: Alterar o schema**

Em `model Tenant`, logo após `createdAt`:
```prisma
  parentTenantId String?
  parent         Tenant?  @relation("TenantParent", fields: [parentTenantId], references: [id], onDelete: Restrict)
  children       Tenant[] @relation("TenantParent")
  active         Boolean  @default(true)
```
e antes do `}` do model: `@@index([parentTenantId])`.
Em `model User`: `isSuperAdmin Boolean @default(false)`.
Em `model Session`: `impersonatorUserId String?`.
Em `model MarketplaceConnection`: `subId String?` (após `affiliateTag`).

- [ ] **Step 4: Gerar a migração e acrescentar a marca de SuperAdmin**

```bash
docker compose up -d --wait postgres redis
pnpm --filter @afilados/db exec prisma migrate dev --name affiliates --create-only
```
Abra o `migration.sql` gerado, confira que contém `ADD COLUMN "parentTenantId"`, `"active" BOOLEAN NOT NULL DEFAULT true`, `"isSuperAdmin"`, `"subId"`, `"impersonatorUserId"`, o índice e a FK com `ON DELETE RESTRICT`, e acrescente ao final:
```sql
UPDATE "User" SET "isSuperAdmin" = true WHERE lower("email") = 'admin@dudurochatec.com';
```
Depois: `pnpm db:deploy && pnpm db:generate`.

- [ ] **Step 5: Seed marca o usuário semeado como SuperAdmin**

Em `packages/db/prisma/seed.ts`, no `prisma.user.upsert`: `update: { isSuperAdmin: true }` e, em `create`, `isSuperAdmin: true,`.

- [ ] **Step 6: Rodar o teste**

Run: `set -a && . ./.env && set +a && pnpm vitest run packages/db/test/affiliate-schema.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(afiliados): schema de tenant pai, SuperAdmin, subId e impersonação"
```

---

### Task 2: Primitivas de link (core, Shopee, cache da Amazon)

**Files:**
- Modify: `packages/core/src/subid.ts`
- Modify: `packages/marketplaces/src/adapter.ts` (interface `toAffiliateLink`)
- Modify: `packages/marketplaces/src/shopee/adapter.ts` (~linha 202)
- Modify: `packages/marketplaces/src/tag-adapter.ts` (~linha 222, chave do cache da Amazon)
- Test: `packages/core/test/subid.test.ts`, `packages/marketplaces/test/shopee.adapter.test.ts`, `packages/marketplaces/test/amazon-cache-per-tag.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeSubId(raw: string | null | undefined): string`
  - `composeLinkSubIds(kind: 'SHOPEE' | 'ALIEXPRESS' | 'AWIN', affiliateSubId: string | null | undefined, patternSubId: string): { subId: string; extraSubIds: string[] }`
  - `applyAffiliateTag(creds: TagCredentials, affiliateTag: string | null | undefined): TagCredentials`
  - `MarketplaceAdapter.toAffiliateLink(creds, url, subId?, extraSubIds?: string[])`

- [ ] **Step 1: Testes que falham**

Acrescente em `packages/core/test/subid.test.ts` (ajuste o import para `import { generateSubId, sanitizeSubId, composeLinkSubIds, applyAffiliateTag } from '../src/subid';`):
```ts
describe('SubID de afiliado', () => {
  it('sanitizeSubId mantém só letras/números e limita a 50', () => {
    expect(sanitizeSubId('joão-silva_1')).toBe('joosilva1');
    expect(sanitizeSubId(null)).toBe('');
    expect(sanitizeSubId('a'.repeat(80))).toHaveLength(50);
  });
  it('Shopee: afiliado + padrão em subIds; sem afiliado usa só o padrão', () => {
    expect(composeLinkSubIds('SHOPEE', 'joao', '20261016lote')).toEqual({
      subId: 'joao',
      extraSubIds: ['20261016lote'],
    });
    expect(composeLinkSubIds('SHOPEE', null, '20261016lote')).toEqual({
      subId: '20261016lote',
      extraSubIds: [],
    });
  });
  it('AliExpress e Awin: só o afiliado', () => {
    expect(composeLinkSubIds('ALIEXPRESS', 'joao', 'x')).toEqual({ subId: 'joao', extraSubIds: [] });
    expect(composeLinkSubIds('AWIN', '  ', 'x')).toEqual({ subId: 'x', extraSubIds: [] });
  });
  it('applyAffiliateTag troca a tag só quando há identificador', () => {
    expect(applyAffiliateTag({ tag: 'dono-20', mattWord: 'm' }, 'joao-20')).toEqual({
      tag: 'joao-20',
      mattWord: 'm',
    });
    expect(applyAffiliateTag({ tag: 'dono-20' }, ' ')).toEqual({ tag: 'dono-20' });
    expect(applyAffiliateTag({ tag: 'dono-20' }, null)).toEqual({ tag: 'dono-20' });
  });
});
```
Em `packages/marketplaces/test/shopee.adapter.test.ts` acrescente (usa `fakeFetch`, `short` e `creds` já existentes no arquivo):
```ts
describe('ShopeeAdapter toAffiliateLink com extraSubIds', () => {
  it('envia subId + extraSubIds em subIds', async () => {
    const fetchImpl = fakeFetch([short]);
    const adapter = createShopeeAdapter({ mock: false, fetchImpl });
    await adapter.toAffiliateLink(creds, 'https://shopee.com.br/product/1/2', 'joao', ['20261016lote']);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body.variables.subIds).toEqual(['joao', '20261016lote']);
  });
});
```
Crie `packages/marketplaces/test/amazon-cache-per-tag.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { createTagAdapter } from '../src/tag-adapter';

describe('cache do link oficial da Amazon', () => {
  it('não reaproveita o link de outra tag (mesma sessão, afiliados diferentes)', async () => {
    const gen = vi.fn(
      async (_u: string, _c: Record<string, string>, storeId: string) => `https://amzn.to/${storeId}`,
    );
    const a = createTagAdapter('AMAZON', { amazonOfficialLink: gen });
    const base = { amazonSession: { cookies: { a: '1' }, syncedAt: '2026-10-16T00:00:00Z' } };
    const url = 'https://www.amazon.com.br/dp/B0TESTCACHE';
    expect(await a.toAffiliateLink({ ...base, tag: 'joao-20' }, url)).toBe('https://amzn.to/joao-20');
    expect(await a.toAffiliateLink({ ...base, tag: 'maria-20' }, url)).toBe('https://amzn.to/maria-20');
    expect(gen).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run packages/core/test/subid.test.ts packages/marketplaces/test/shopee.adapter.test.ts packages/marketplaces/test/amazon-cache-per-tag.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`packages/core/src/subid.ts` — acrescente `import type { TagCredentials } from '@afilados/shared';` no topo e ao final:
```ts
/** Mesma regra do generateSubId: a Shopee só aceita letras e números (máx. 50). */
export function sanitizeSubId(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
}

export interface LinkSubIds {
  subId: string;
  extraSubIds: string[];
}

/**
 * SubIDs de um link gerado por API. Com identificador de afiliado: Shopee leva ele + o padrão
 * data/lote; AliExpress/Awin levam só ele. Sem identificador: comportamento antigo (só o padrão).
 */
export function composeLinkSubIds(
  kind: 'SHOPEE' | 'ALIEXPRESS' | 'AWIN',
  affiliateSubId: string | null | undefined,
  patternSubId: string,
): LinkSubIds {
  const aff = sanitizeSubId(affiliateSubId);
  if (!aff) return { subId: patternSubId, extraSubIds: [] };
  if (kind === 'SHOPEE' && patternSubId) return { subId: aff, extraSubIds: [patternSubId] };
  return { subId: aff, extraSubIds: [] };
}

/** Amazon/ML/Magalu: o identificador do afiliado vira a `tag` (tracking ID, etiqueta ou loja). */
export function applyAffiliateTag(
  creds: TagCredentials,
  affiliateTag: string | null | undefined,
): TagCredentials {
  const tag = affiliateTag?.trim();
  return tag ? { ...creds, tag } : creds;
}
```
`packages/marketplaces/src/adapter.ts`: troque a linha por
```ts
  /** `extraSubIds` só é usado pela Shopee (subIds = [subId, ...extraSubIds]); os demais ignoram. */
  toAffiliateLink(creds: C, url: string, subId?: string, extraSubIds?: string[]): Promise<string>;
```
`packages/marketplaces/src/shopee/adapter.ts`: `async toAffiliateLink(creds, url, subId, extraSubIds): Promise<string> {` e `subIds: [subId, ...(extraSubIds ?? [])].filter((s): s is string => Boolean(s)),`.
`packages/marketplaces/src/tag-adapter.ts`: `const cacheKey = \`AMAZON:${creds.tag?.trim() ?? ''}:${url}\`;`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run packages/core packages/marketplaces && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/marketplaces
git commit -m "feat(afiliados): composição de SubIDs, tag do afiliado e cache da Amazon por tag"
```

---

### Task 3: Resolvedor em `@afilados/db`

**Files:**
- Create: `packages/db/src/client.ts`, `packages/db/src/affiliate.ts`, `packages/db/src/defaults.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/prisma/seed.ts`
- Test: `packages/db/test/affiliate-resolver.test.ts`

**Interfaces:**
- Produces (todas exportadas de `@afilados/db`):
  - `forTenant(id).$tenantId: string`
  - `type ResolvedConnection = { row: MarketplaceConnection | null; ownerTenantId: string; subId: string | null; isAffiliate: boolean }`
  - `getParentTenantId(tenantId): Promise<string | null>`
  - `resolveConnection(tenantId, kind: MarketplaceKind): Promise<ResolvedConnection>`
  - `resolveConnections(tenantId): Promise<Map<MarketplaceKind, ResolvedConnection>>`
  - `mergeAffiliateAi(own?: StoredAiConfig, parent?: StoredAiConfig): StoredAiConfig`
  - `resolveSettings(tenantId): Promise<Record<string, unknown>>` (Settings do tenant; para afiliado, `ai` mesclado com o pai)
  - `isTenantActive(tenantId): Promise<boolean>`
  - `listTenantsWithCredentials(kinds: MarketplaceKind[]): Promise<string[]>`
  - `DEFAULT_TEMPLATE: string`, `DEFAULT_SETTINGS: Record<string, unknown>`

- [ ] **Step 1: Teste que falha**

```ts
// packages/db/test/affiliate-resolver.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  prisma, forTenant, encryptJson, resolveConnection, resolveConnections, resolveSettings,
  mergeAffiliateAi, isTenantActive, listTenantsWithCredentials,
} from '../src/index';

let root: string; let aff: string; let affNoRow: string; let inactive: string;
const rootCreds = encryptJson({ appId: 'root-app', secret: 'root-secret' });

beforeAll(async () => {
  root = (await prisma.tenant.create({ data: { name: 'res-root' } })).id;
  aff = (await prisma.tenant.create({ data: { name: 'res-aff', parentTenantId: root } })).id;
  affNoRow = (await prisma.tenant.create({ data: { name: 'res-aff2', parentTenantId: root } })).id;
  inactive = (
    await prisma.tenant.create({ data: { name: 'res-off', parentTenantId: root, active: false } })
  ).id;
  await prisma.marketplaceConnection.create({
    data: { tenantId: root, kind: 'SHOPEE', encryptedCredentials: rootCreds, status: 'OK' },
  });
  await prisma.marketplaceConnection.create({ data: { tenantId: aff, kind: 'SHOPEE', subId: ' joao ' } });
  await prisma.setting.create({
    data: {
      tenantId: root, key: 'ai',
      value: { enabled: false, baseUrl: 'https://vps/v1', model: 'combo', encryptedApiKey: 'KEY', tone: 'urgente' },
    },
  });
  await prisma.setting.create({
    data: { tenantId: aff, key: 'ai', value: { enabled: true, baseUrl: 'https://evil', model: 'x', tone: 'divertido' } },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [aff, affNoRow, inactive] } } });
  await prisma.tenant.deleteMany({ where: { id: root } });
  await prisma.$disconnect();
});

describe('resolveConnection', () => {
  it('raiz: usa a própria linha, subId null', async () => {
    const r = await resolveConnection(root, 'SHOPEE');
    expect(r).toMatchObject({ ownerTenantId: root, subId: null, isAffiliate: false });
    expect(r.row?.tenantId).toBe(root);
  });
  it('afiliado: credencial do pai, subId do próprio (aparado)', async () => {
    const r = await resolveConnection(aff, 'SHOPEE');
    expect(r).toMatchObject({ ownerTenantId: root, subId: 'joao', isAffiliate: true });
    expect(r.row?.tenantId).toBe(root);
  });
  it('afiliado sem linha própria: subId null; pai sem credencial: row null', async () => {
    expect((await resolveConnection(affNoRow, 'SHOPEE')).subId).toBeNull();
    expect((await resolveConnection(aff, 'AMAZON')).row).toBeNull();
  });
  it('resolveConnections devolve mapa por kind', async () => {
    const m = await resolveConnections(aff);
    expect(m.get('SHOPEE')).toMatchObject({ subId: 'joao', isAffiliate: true });
    expect(m.has('AMAZON')).toBe(false);
  });
});

describe('IA e settings', () => {
  it('mergeAffiliateAi: credenciais do pai, preferências do afiliado', () => {
    const m = mergeAffiliateAi(
      { enabled: true, baseUrl: 'x', model: 'y', encryptedApiKey: 'MINE', tone: 'divertido' },
      { enabled: false, baseUrl: 'https://vps/v1', model: 'combo', encryptedApiKey: 'KEY' },
    );
    expect(m).toMatchObject({ enabled: true, baseUrl: 'https://vps/v1', model: 'combo', encryptedApiKey: 'KEY', tone: 'divertido' });
  });
  it('mergeAffiliateAi sem pai configurado deixa incompleto', () => {
    expect(mergeAffiliateAi({ enabled: true, baseUrl: '', model: '' }, undefined)).toEqual({
      enabled: true, baseUrl: '', model: '',
    });
  });
  it('resolveSettings: afiliado herda credencial de IA; raiz não muda', async () => {
    const a = (await resolveSettings(aff)).ai as Record<string, unknown>;
    expect(a).toMatchObject({ enabled: true, baseUrl: 'https://vps/v1', encryptedApiKey: 'KEY', tone: 'divertido' });
    const r = (await resolveSettings(root)).ai as Record<string, unknown>;
    expect(r).toMatchObject({ baseUrl: 'https://vps/v1', tone: 'urgente' });
  });
});

describe('tenants', () => {
  it('isTenantActive', async () => {
    expect(await isTenantActive(aff)).toBe(true);
    expect(await isTenantActive(inactive)).toBe(false);
  });
  it('listTenantsWithCredentials: dono + afiliados ativos', async () => {
    const ids = await listTenantsWithCredentials(['SHOPEE']);
    expect(ids).toEqual(expect.arrayContaining([root, aff, affNoRow]));
    expect(ids).not.toContain(inactive);
  });
  it('forTenant expõe $tenantId', () => {
    expect(forTenant(aff).$tenantId).toBe(aff);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run packages/db/test/affiliate-resolver.test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: `client.ts` e `index.ts`**

`packages/db/src/client.ts`:
```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```
Em `packages/db/src/index.ts` substitua as linhas iniciais (import do PrismaClient, `globalForPrisma`, `export const prisma`, `if (...)`) por:
```ts
import { prisma } from './client';

export * from '@prisma/client';
export * from './crypto';
export * from './affiliate';
export * from './defaults';
export { prisma };
```
Em `forTenant`, troque `return prisma.$extends({` por `const scoped = prisma.$extends({` e, no fim da função (antes do `}` que a fecha), acrescente `return scoped.$extends({ client: { $tenantId: tenantId } });`.

- [ ] **Step 4: `defaults.ts`**

Mova `DEFAULT_TEMPLATE` de `seed.ts` para cá (mesmo texto) e acrescente:
```ts
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  globalRateLimitPerMin: 6,
  subIdPattern: '{yyyyMMdd}-{batchId}',
};
```
No `seed.ts`: `import { DEFAULT_TEMPLATE, DEFAULT_SETTINGS } from '../src/defaults';`, remova a constante local e troque `const settings: Record<string, unknown> = {...}` por `const settings = DEFAULT_SETTINGS;`.

- [ ] **Step 5: `affiliate.ts`**

```ts
import type { MarketplaceConnection, MarketplaceKind } from '@prisma/client';
import type { StoredAiConfig } from '@afilados/shared';
import { prisma } from './client';

const AI_KEY = 'ai';

export interface ResolvedConnection {
  /** Linha com as credenciais: a do tenant pai (afiliado) ou a do próprio tenant (raiz). */
  row: MarketplaceConnection | null;
  /** Tenant que guarda as credenciais; é onde renovações de token são gravadas. */
  ownerTenantId: string;
  /** SubID/tracking ID/etiqueta/loja do afiliado; sempre null em tenant raiz. */
  subId: string | null;
  isAffiliate: boolean;
}

export async function getParentTenantId(tenantId: string): Promise<string | null> {
  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { parentTenantId: true },
  });
  return t.parentTenantId;
}

export async function resolveConnection(
  tenantId: string,
  kind: MarketplaceKind,
): Promise<ResolvedConnection> {
  const parentId = await getParentTenantId(tenantId);
  if (!parentId) {
    const row = await prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } });
    return { row, ownerTenantId: tenantId, subId: null, isAffiliate: false };
  }
  const [own, owner] = await Promise.all([
    prisma.marketplaceConnection.findFirst({ where: { tenantId, kind } }),
    prisma.marketplaceConnection.findFirst({ where: { tenantId: parentId, kind } }),
  ]);
  return {
    row: owner,
    ownerTenantId: parentId,
    subId: own?.subId?.trim() || null,
    isAffiliate: true,
  };
}

export async function resolveConnections(
  tenantId: string,
): Promise<Map<MarketplaceKind, ResolvedConnection>> {
  const parentId = await getParentTenantId(tenantId);
  const own = await prisma.marketplaceConnection.findMany({ where: { tenantId } });
  const map = new Map<MarketplaceKind, ResolvedConnection>();
  if (!parentId) {
    for (const row of own) {
      map.set(row.kind, { row, ownerTenantId: tenantId, subId: null, isAffiliate: false });
    }
    return map;
  }
  const owner = await prisma.marketplaceConnection.findMany({ where: { tenantId: parentId } });
  for (const row of owner) {
    const mine = own.find((o) => o.kind === row.kind);
    map.set(row.kind, {
      row,
      ownerTenantId: parentId,
      subId: mine?.subId?.trim() || null,
      isAffiliate: true,
    });
  }
  return map;
}

/** Credenciais de IA vêm do pai; preferências (ativar, tom, emojis...) são do afiliado. */
export function mergeAffiliateAi(
  own: StoredAiConfig | undefined,
  parent: StoredAiConfig | undefined,
): StoredAiConfig {
  const { baseUrl: _b, model: _m, encryptedApiKey: _k, ...ownRest } = (own ?? {}) as Partial<StoredAiConfig>;
  return {
    ...ownRest,
    enabled: own?.enabled ?? false,
    baseUrl: parent?.baseUrl ?? '',
    model: parent?.model ?? '',
    ...(parent?.encryptedApiKey ? { encryptedApiKey: parent.encryptedApiKey } : {}),
  };
}

export async function resolveSettings(tenantId: string): Promise<Record<string, unknown>> {
  const parentId = await getParentTenantId(tenantId);
  const rows = await prisma.setting.findMany({ where: { tenantId } });
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  if (parentId) {
    const parentAi = await prisma.setting.findFirst({ where: { tenantId: parentId, key: AI_KEY } });
    settings[AI_KEY] = mergeAffiliateAi(
      settings[AI_KEY] as StoredAiConfig | undefined,
      parentAi?.value as StoredAiConfig | undefined,
    );
  }
  return settings;
}

export async function isTenantActive(tenantId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { active: true } });
  return t?.active ?? false;
}

/** Tenants ativos que podem usar credenciais de `kinds`: donos com credencial + seus afiliados. */
export async function listTenantsWithCredentials(kinds: MarketplaceKind[]): Promise<string[]> {
  const owners = await prisma.marketplaceConnection.findMany({
    where: { kind: { in: kinds }, encryptedCredentials: { not: null } },
    select: { tenantId: true },
  });
  const ownerIds = [...new Set(owners.map((o) => o.tenantId))];
  const affiliates = ownerIds.length
    ? await prisma.tenant.findMany({
        where: { parentTenantId: { in: ownerIds } },
        select: { id: true },
      })
    : [];
  const all = [...ownerIds, ...affiliates.map((a) => a.id)];
  const active = await prisma.tenant.findMany({
    where: { id: { in: all }, active: true },
    select: { id: true },
  });
  return active.map((t) => t.id);
}
```

- [ ] **Step 6: Rodar tudo do pacote**

Run: `set -a && . ./.env && set +a && pnpm vitest run packages/db && pnpm typecheck`
Expected: PASS (testes antigos de `tenant.test.ts` continuam passando).

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(afiliados): resolvedor de credenciais/IA do tenant pai e \$tenantId no forTenant"
```

---

### Task 4: API lê credenciais pelo resolvedor

**Files:**
- Modify: `apps/api/src/lib/marketplaces.ts`, `apps/api/src/lib/amazon-listing.ts`, `apps/api/src/lib/ml-api.ts`, `apps/api/src/routes/coupons.ts` (~linha 237), `apps/api/src/routes/overview.ts`
- Modify: `apps/api/test/helpers.ts`
- Test: `apps/api/test/affiliate-credentials.test.ts`

**Interfaces:**
- Consumes: `resolveConnection`, `forTenant(...).$tenantId` (Task 3).
- Produces: `createTenantWithUser(name?, parentTenantId?)` e `cleanupTenant` que limpa afiliados filhos primeiro; `publicAffiliateConnection(owner, own, kind)`, `setAffiliateSubId(db, kind, subId)` (usados na Task 10).

- [ ] **Step 1: Helpers de teste**

Em `apps/api/test/helpers.ts`:
```ts
export async function createTenantWithUser(name = 'T', parentTenantId?: string) {
  const tenant = await prisma.tenant.create({
    data: { name, ...(parentTenantId ? { parentTenantId } : {}) },
  });
  // ... (resto igual)
}

export async function cleanupTenant(tenantId: string) {
  const children = await prisma.tenant.findMany({
    where: { parentTenantId: tenantId },
    select: { id: true },
  });
  for (const c of children) await cleanupTenant(c.id);
  await prisma.batch.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}
```

- [ ] **Step 2: Teste que falha**

```ts
// apps/api/test/affiliate-credentials.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant, encryptJson } from '@afilados/db';
import { loadShopeeCredentials, loadTagCredentials, loadAwinCredentials } from '../src/lib/marketplaces';
import { createTenantWithUser, cleanupTenant } from './helpers';

let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'SHOPEE', status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'root-app', secret: 's' }) },
  });
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'AMAZON',
      encryptedCredentials: encryptJson({ tag: 'dono-20', amazonApi: { clientId: 'c', clientSecret: 's' } }) },
  });
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'AWIN',
      encryptedCredentials: encryptJson({ feedListUrl: 'https://ui.awin.com/feedList/x', feedIds: ['f1'] }) },
  });
});
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
});

describe('afiliado lê credenciais do pai', () => {
  it('Shopee', async () => {
    const r = await loadShopeeCredentials(forTenant(aff.tenantId));
    expect(r.creds.appId).toBe('root-app');
  });
  it('Amazon (tag + Creators API)', async () => {
    const c = await loadTagCredentials(forTenant(aff.tenantId), 'AMAZON');
    expect(c.tag).toBe('dono-20');
    expect(c.amazonApi?.clientId).toBe('c');
  });
  it('Awin', async () => {
    const c = await loadAwinCredentials(forTenant(aff.tenantId));
    expect(c.feedIds).toEqual(['f1']);
  });
  it('tenant raiz sem credencial continua com erro de configuração', async () => {
    const lonely = await createTenantWithUser('sem-credencial');
    try {
      await expect(loadShopeeCredentials(forTenant(lonely.tenantId))).rejects.toThrow(/Configure a API da Shopee/);
    } finally {
      await cleanupTenant(lonely.tenantId);
    }
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api/test/affiliate-credentials.test.ts`
Expected: FAIL (afiliado não acha credencial).

- [ ] **Step 4: `lib/marketplaces.ts`**

Adicione `resolveConnection` ao import de `@afilados/db`. Em `loadShopeeCredentials`, `loadTagCredentials`, `loadAwinCredentials` e `loadAliexpressCredentials`, troque a leitura
`const row = await db.marketplaceConnection.findFirst({ where: { kind: ... } });`
por
`const { row } = await resolveConnection(db.$tenantId, <kind>);`
(`'SHOPEE'`, `kind`, `'AWIN'`, `'ALIEXPRESS'`). Em `publicConnection` acrescente `subId: row?.subId ?? null,` e ao final do arquivo:
```ts
/** Visão do afiliado: status do marketplace (do dono) + o identificador dele; nada de credenciais. */
export function publicAffiliateConnection(
  owner: MarketplaceConnection | null,
  own: MarketplaceConnection | null,
  kind: MarketplaceConnection['kind'],
) {
  return {
    ...publicConnection(null, kind),
    status: owner?.status ?? 'UNCONFIGURED',
    subId: own?.subId ?? null,
    lastCheckedAt: owner?.lastCheckedAt ?? null,
    lastError: null,
  };
}

export async function setAffiliateSubId(
  db: TenantClient,
  kind: MarketplaceConnection['kind'],
  subId: string,
) {
  const value = subId.trim() || null;
  const existing = await db.marketplaceConnection.findFirst({ where: { kind } });
  if (existing) {
    await db.marketplaceConnection.updateMany({ where: { id: existing.id }, data: { subId: value } });
  } else {
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    await db.marketplaceConnection.create({ data: { kind, subId: value } });
  }
}
```
`apps/api/src/lib/amazon-listing.ts`: `const { row } = await resolveConnection(db.$tenantId, 'AMAZON');` (importe `resolveConnection`).

- [ ] **Step 5: `lib/ml-api.ts`** (token do ML é único do dono)

Importe `forTenant, resolveConnection` de `@afilados/db`. Substitua:
```ts
async function readCreds(db: TenantClient) {
  const { row } = await resolveConnection(db.$tenantId, 'MERCADOLIVRE');
  const creds = row?.encryptedCredentials
    ? decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials))
    : {};
  return { row, creds };
}

/** Grava sempre no tenant dono das credenciais (o refresh_token é único e compartilhado). */
async function saveTokens(ownerTenantId: string, tokens: MlApiTokens): Promise<void> {
  await upsertMarketplaceCredentials(
    forTenant(ownerTenantId),
    'MERCADOLIVRE',
    (prev) => ({ ...prev, mlApi: tokens }),
    (_merged, existing) => ({ status: existing?.status ?? 'OK' }),
  );
}
```
Em `ensureWithLock`: `ensureMlAccessToken(latest, cfg, (t) => saveTokens(tenantId, t))` (o `tenantId` recebido já é `row.tenantId`, ou seja, o dono). No ramo `ML_API_UNAUTHORIZED` de `loadMlApiCredentials`, troque `db.marketplaceConnection.updateMany` por `forTenant(row.tenantId).marketplaceConnection.updateMany`.

- [ ] **Step 6: `routes/coupons.ts` e `routes/overview.ts`**

`/coupons/sync`:
```ts
const [{ row: aliConn }, { row: awinConn }] = await Promise.all([
  resolveConnection(req.tenantId, 'ALIEXPRESS'),
  resolveConnection(req.tenantId, 'AWIN'),
]);
```
`overview.ts`: no `Promise.all`, troque o `req.db.marketplaceConnection.findFirst({ where: { kind: 'SHOPEE' }, select: { status: true } })` por `resolveConnection(req.tenantId, 'SHOPEE')` e, no retorno, `shopee: shopee.row?.status ?? 'UNCONFIGURED'`. Importe `resolveConnection` de `@afilados/db` nos dois.

- [ ] **Step 7: Rodar API inteira**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api && pnpm typecheck`
Expected: PASS (testes existentes de marketplaces/cupons/overview intactos; teste novo passa).

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(afiliados): API lê credenciais de marketplace pelo tenant pai"
```

---

### Task 5: Worker lê credenciais pelo resolvedor

**Files:**
- Modify: `apps/worker/src/lib/marketplace-credentials.ts`, `apps/worker/src/automation/discovery.ts` (~176 e ~202), `apps/worker/src/processors/awin-import.ts` (~119), `apps/worker/src/processors/coupon-sync.ts` (~43 e ~100), `apps/worker/src/processors/product-enrich.ts` (~54 e ~63)
- Test: `apps/worker/test/marketplace-credentials.test.ts`

**Interfaces:**
- Consumes: `resolveConnection` (Task 3).
- Produces: `loadTagCredentialsForLink(tenantId, kind)` em `marketplace-credentials.ts` (credenciais com a etiqueta do afiliado aplicada; usado na Task 6).

- [ ] **Step 1: Teste que falha**

Acrescente em `apps/worker/test/marketplace-credentials.test.ts` (importe `loadAwinCredentials` e `loadTagCredentialsForLink` de `../src/lib/marketplace-credentials`):
```ts
describe('afiliado (worker)', () => {
  it('carrega credenciais do pai e aplica a etiqueta do afiliado só no link', async () => {
    const owner = await prisma.tenant.create({ data: { name: 'w-owner' } });
    const aff = await prisma.tenant.create({ data: { name: 'w-aff', parentTenantId: owner.id } });
    try {
      await prisma.marketplaceConnection.create({
        data: { tenantId: owner.id, kind: 'MERCADOLIVRE',
          encryptedCredentials: encryptJson({ tag: 'dono', mattWord: 'm', mattTool: '1' }) },
      });
      await prisma.marketplaceConnection.create({
        data: { tenantId: aff.id, kind: 'MERCADOLIVRE', subId: 'joaoml' },
      });
      await prisma.marketplaceConnection.create({
        data: { tenantId: owner.id, kind: 'AWIN',
          encryptedCredentials: encryptJson({ feedListUrl: 'https://ui.awin.com/feedList/x', feedIds: ['f'] }) },
      });
      expect((await loadTagCredentialsForLink(aff.id, 'MERCADOLIVRE')).tag).toBe('joaoml');
      expect((await loadTagCredentials(aff.id, 'MERCADOLIVRE')).tag).toBe('dono');
      expect((await loadTagCredentialsForLink(owner.id, 'MERCADOLIVRE')).tag).toBe('dono');
      expect((await loadAwinCredentials(aff.id)).feedIds).toEqual(['f']);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: aff.id } });
      await prisma.tenant.deleteMany({ where: { id: owner.id } });
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/worker/test/marketplace-credentials.test.ts`
Expected: FAIL.

- [ ] **Step 3: `marketplace-credentials.ts`**

Importe `resolveConnection` de `@afilados/db` e `applyAffiliateTag` de `@afilados/core`. Troque as leituras:
- `loadTagCredentials`: `const { row } = await resolveConnection(tenantId, kind);`
- `loadAwinCredentials`: `const { row } = await resolveConnection(tenantId, 'AWIN');`
- `loadAliexpressCredentials`: `const { row } = await resolveConnection(tenantId, 'ALIEXPRESS');`
- `readMlRow`: `const { row } = await resolveConnection(tenantId, 'MERCADOLIVRE');`
- em `loadMlApiCredentials`, `ensureMlTokenWithLock(row.tenantId, creds.mlApi, cfg)` (lock e gravação pelo dono, pois `row` é a linha do dono).

Acrescente:
```ts
/** Credenciais por tag já com a etiqueta do afiliado (quando houver) — usadas na geração de link. */
export async function loadTagCredentialsForLink(
  tenantId: string,
  kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): Promise<TagCredentials> {
  const creds = await loadTagCredentials(tenantId, kind);
  const { subId } = await resolveConnection(tenantId, kind);
  return applyAffiliateTag(creds, subId);
}
```

- [ ] **Step 4: Demais leituras do worker**

Em cada ponto troque `prisma.marketplaceConnection.findFirst({ where: { tenantId, kind: 'X' } })` por `(await resolveConnection(tenantId, 'X')).row` e importe `resolveConnection`:
- `discovery.ts` `discoverShopee`/`discoverAliexpress`: `const { row: conn } = await resolveConnection(rule.tenantId, 'SHOPEE');` (idem `'ALIEXPRESS'`).
- `awin-import.ts`: `const { row: conn } = await resolveConnection(tenantId, 'AWIN');`
- `coupon-sync.ts`: `const { row: aliConn } = await resolveConnection(tenantId, 'ALIEXPRESS');` e `const { row: awinConn } = await resolveConnection(tenantId, 'AWIN');`
- `product-enrich.ts`: `const { row: conn } = await resolveConnection(tenantId, 'SHOPEE');` e `'ALIEXPRESS'`.

- [ ] **Step 5: Rodar o worker**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/worker && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(afiliados): worker lê credenciais de marketplace pelo tenant pai"
```

---

### Task 6: Links de afiliado com SubID (envio, Telegram, espelhamento, pré-aquecimento ML)

**Files:**
- Modify: `apps/worker/src/processors/send-offer.ts` (~87-99 e ~190-235), `apps/worker/src/processors/send-telegram.ts` (~35-60 e ~85-130), `apps/worker/src/processors/mirror-message.ts` (~149-235), `apps/worker/src/processors/ml-links-prewarm.ts` (~34)
- Test: `apps/worker/test/send-offer.test.ts`, `apps/worker/test/send-telegram-affiliate.test.ts`, `apps/worker/test/mirror-message.test.ts`

**Interfaces:**
- Consumes: `resolveConnection(s)`, `resolveSettings` (Task 3); `composeLinkSubIds`, `applyAffiliateTag`, `generateSubId` (Task 2); `loadTagCredentialsForLink` (Task 5).

- [ ] **Step 1: Testes que falham**

`apps/worker/test/send-offer.test.ts` — acrescente um `describe` (usa `FakeGateway`, `deps`, `sendOffer`, `encryptJson`, `createShopeeAdapter`, `vi` já importados):
```ts
describe('sendOffer com afiliado', () => {
  async function setup(opts: { subId?: string; source?: 'SHOPEE' | 'MAGALU' }) {
    const source = opts.source ?? 'SHOPEE';
    const owner = await prisma.tenant.create({ data: { name: 'so-owner' } });
    const aff = await prisma.tenant.create({ data: { name: 'so-aff', parentTenantId: owner.id } });
    await prisma.marketplaceConnection.create({
      data: { tenantId: owner.id, kind: source, status: 'OK',
        encryptedCredentials: encryptJson(source === 'SHOPEE' ? { appId: 'a', secret: 's' } : { tag: 'lojadono' }) },
    });
    if (opts.subId) {
      await prisma.marketplaceConnection.create({ data: { tenantId: aff.id, kind: source, subId: opts.subId } });
    }
    const session = await prisma.waSession.create({ data: { tenantId: aff.id, label: 's', status: 'CONNECTED' } });
    const template = await prisma.template.create({ data: { tenantId: aff.id, name: 't', body: '{link}' } });
    const product = await prisma.product.create({
      data: { tenantId: aff.id, source, externalId: '9', title: 'P', price: 10, images: ['https://img/x.jpg'],
        originalUrl: source === 'SHOPEE' ? 'https://shopee.com.br/product/1/9' : 'https://www.magazineluiza.com.br/p/abc/', raw: {} },
    });
    const batch = await prisma.batch.create({
      data: { tenantId: aff.id, sessionId: session.id, templateId: template.id, name: 'b', groupJids: ['g1@g.us'],
        telegramChatIds: [], intervalMin: 1, mediaMode: 'IMAGE', status: 'SCHEDULED',
        items: { create: [{ productId: product.id, order: 0, runAt: new Date() }] } },
      include: { items: true },
    });
    const cleanup = async () => {
      await prisma.batch.deleteMany({ where: { tenantId: aff.id } });
      await prisma.tenant.deleteMany({ where: { id: aff.id } });
      await prisma.tenant.deleteMany({ where: { id: owner.id } });
    };
    return { batch, item: batch.items[0]!, cleanup, aff };
  }

  it('Shopee: subIds = [identificador do afiliado, padrão data/lote]', async () => {
    const { batch, item, cleanup } = await setup({ subId: 'joao' });
    try {
      const toAffiliateLink = vi.fn(async () => 'https://s.shopee.com.br/AFF');
      await sendOffer({ ...deps, shopee: { ...createShopeeAdapter({ mock: true }), toAffiliateLink } }, item.id);
      expect(toAffiliateLink).toHaveBeenCalledWith(
        expect.objectContaining({ appId: 'a' }),
        'https://shopee.com.br/product/1/9',
        'joao',
        [`20260914${batch.id}`],
      );
    } finally { await cleanup(); }
  });

  it('Shopee sem identificador: só o padrão (sem extras)', async () => {
    const { batch, item, cleanup } = await setup({});
    try {
      const toAffiliateLink = vi.fn(async () => 'https://s.shopee.com.br/AFF');
      await sendOffer({ ...deps, shopee: { ...createShopeeAdapter({ mock: true }), toAffiliateLink } }, item.id);
      expect(toAffiliateLink).toHaveBeenCalledWith(expect.anything(), expect.any(String), `20260914${batch.id}`, []);
    } finally { await cleanup(); }
  });

  it('Magalu: a loja do afiliado vira a tag das credenciais do dono', async () => {
    const { item, cleanup } = await setup({ subId: 'lojajoao', source: 'MAGALU' });
    try {
      const toAffiliateLink = vi.fn(async () => 'https://www.magazinevoce.com.br/lojajoao/p/abc/');
      const getTagAdapter = (() => ({ kind: 'MAGALU', toAffiliateLink })) as never;
      await sendOffer({ ...deps, getTagAdapter }, item.id);
      expect(toAffiliateLink).toHaveBeenCalledWith(expect.objectContaining({ tag: 'lojajoao' }), expect.any(String));
    } finally { await cleanup(); }
  });

  it('tenant inativo: não envia', async () => {
    const { item, cleanup, aff } = await setup({ subId: 'joao' });
    try {
      await prisma.tenant.update({ where: { id: aff.id }, data: { active: false } });
      const r = await sendOffer(deps, item.id);
      expect(r).toEqual({ outcome: 'skipped', reason: 'tenant-inactive' });
    } finally { await cleanup(); }
  });
});
```
`apps/worker/test/send-telegram-affiliate.test.ts`:
```ts
import { describe, it, expect, vi, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { generateSubId } from '@afilados/core';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';

const owner = await prisma.tenant.create({ data: { name: 'tg-owner' } });
const aff = await prisma.tenant.create({ data: { name: 'tg-aff', parentTenantId: owner.id } });
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: aff.id } });
  await prisma.tenant.deleteMany({ where: { id: owner.id } });
  await prisma.$disconnect();
});

describe('sendTelegram com afiliado', () => {
  it('Shopee usa credencial do dono e subIds [afiliado, padrão]', async () => {
    await prisma.marketplaceConnection.create({
      data: { tenantId: owner.id, kind: 'SHOPEE', encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }) },
    });
    await prisma.marketplaceConnection.create({ data: { tenantId: aff.id, kind: 'SHOPEE', subId: 'maria' } });
    const bot = await prisma.telegramBot.create({
      data: { tenantId: aff.id, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    });
    const template = await prisma.template.create({ data: { tenantId: aff.id, name: 't', body: '{link}' } });
    const product = await prisma.product.create({
      data: { tenantId: aff.id, source: 'SHOPEE', externalId: '1', title: 'P', price: 5,
        images: ['https://img/x.jpg'], originalUrl: 'https://shopee.com.br/product/1/1', raw: {} },
    });
    const toAffiliateLink = vi.fn(async () => 'https://s.shopee.com.br/AFF');
    const deps: SendTelegramDeps = {
      shopee: { ...createShopeeAdapter({ mock: true }), toAffiliateLink },
      awin: createAwinAdapter(),
      now: () => new Date('2026-09-14T12:00:00-03:00'),
      makeClient: () => ({ sendMessage: vi.fn(async () => ({ messageId: 1 })), sendPhoto: vi.fn(async () => ({ messageId: 2 })) }) as unknown as TelegramClient,
    };
    await sendTelegram(deps, { tenantId: aff.id, botId: bot.id, chatId: '-1', templateId: template.id, productId: product.id });
    const pattern = generateSubId('{yyyyMMdd}-{batchId}', { now: new Date('2026-09-14T12:00:00-03:00'), batchId: bot.id });
    expect(toAffiliateLink).toHaveBeenCalledWith(expect.objectContaining({ appId: 'a' }), product.originalUrl, 'maria', [pattern]);
  });
});
```
`apps/worker/test/mirror-message.test.ts` — acrescente ao `describe` principal (usa `fakeGateway`, `MirrorMessageJob`, `encryptJson`):
```ts
  it('afiliado: link Amazon espelhado com a tracking ID do afiliado (credencial do dono)', async () => {
    const owner = await prisma.tenant.create({ data: { name: 'mirror-owner' } });
    const aff = await prisma.tenant.create({ data: { name: 'mirror-aff', parentTenantId: owner.id } });
    try {
      await prisma.marketplaceConnection.create({
        data: { tenantId: owner.id, kind: 'AMAZON', encryptedCredentials: encryptJson({ tag: 'dono-20' }), status: 'OK' },
      });
      await prisma.marketplaceConnection.create({ data: { tenantId: aff.id, kind: 'AMAZON', subId: 'joao-20' } });
      const sess = await prisma.waSession.create({ data: { tenantId: aff.id, label: 's' } });
      const rule = await prisma.mirrorRule.create({
        data: { tenantId: aff.id, sessionId: sess.id, sourceJids: ['s@g.us'], targetJids: ['t1@g.us'],
          mode: 'CLONE', mediaMode: 'PREVIEW', enabled: true },
      });
      const res = await mirrorMessage({ gateway: fakeGateway, sleep: async () => {} }, {
        tenantId: aff.id, ruleId: rule.id, sessionId: sess.id, sourceJid: 's@g.us', msgId: 'M-aff',
        message: { message: { conversation: 'Olha: https://www.amazon.com.br/dp/B0ABCDEF12' } },
      });
      expect(res).toEqual({ outcome: 'mirrored', count: 1 });
      expect(fakeGateway.sendMessage).toHaveBeenCalledWith(
        sess.id, 't1@g.us',
        expect.objectContaining({ text: 'Olha: https://www.amazon.com.br/dp/B0ABCDEF12?tag=joao-20' }),
        { dedupeEcho: true },
      );
    } finally {
      await prisma.tenant.deleteMany({ where: { id: aff.id } });
      await prisma.tenant.deleteMany({ where: { id: owner.id } });
    }
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/worker/test/send-offer.test.ts apps/worker/test/send-telegram-affiliate.test.ts apps/worker/test/mirror-message.test.ts`
Expected: FAIL nos novos testes.

- [ ] **Step 3: `send-offer.ts`**

Imports: `resolveConnection, resolveSettings, isTenantActive` de `@afilados/db`; `composeLinkSubIds, applyAffiliateTag` de `@afilados/core`. Amplie o tipo: `| { outcome: 'skipped'; reason: 'batch-inactive' | 'missing' | 'tenant-inactive' }`. Logo após `const tenantId = batch.tenantId;`:
```ts
  if (!(await isTenantActive(tenantId))) return { outcome: 'skipped', reason: 'tenant-inactive' };
```
Substitua o `Promise.all` de leitura e o bloco `const settings = Object.fromEntries(...)` por:
```ts
  const [windowRow, settings, resolved] = await Promise.all([
    prisma.operatingWindow.findUnique({ where: { tenantId } }),
    resolveSettings(tenantId),
    product && product.source !== 'MANUAL'
      ? resolveConnection(tenantId, product.source)
      : Promise.resolve(null),
  ]);
  const conn = resolved?.row ?? null;
  const affiliateSubId = resolved?.subId ?? null;
```
Nos ramos de link: em Shopee
```ts
      const pattern = generateSubId(subIdPattern, { now: t, batchId: batch.id, timezone: window.timezone });
      const { subId, extraSubIds } = composeLinkSubIds('SHOPEE', affiliateSubId, pattern);
      affiliateLink = await deps.shopee.toAffiliateLink(creds, product.originalUrl, subId, extraSubIds);
```
em Awin e AliExpress, troque o `generateSubId(...)` por `composeLinkSubIds('AWIN' | 'ALIEXPRESS', affiliateSubId, generateSubId(...)).subId` (mesmos argumentos de antes), e no ramo de tags:
```ts
      const creds = applyAffiliateTag(
        decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials)),
        affiliateSubId,
      );
```

- [ ] **Step 4: `send-telegram.ts`**

Imports iguais (`isTenantActive` também). Troque o `Promise.all` inicial para `resolveSettings(job.tenantId)` no lugar de `prisma.setting.findMany(...)` (variável `settings`) e remova o `Object.fromEntries`. Depois de `if (!bot || !template) return;` e da checagem de tenant do bot, acrescente:
```ts
  if (!(await isTenantActive(job.tenantId))) {
    log.info({ tenantId: job.tenantId }, 'tenant inativo; envio ao Telegram ignorado');
    return;
  }
```
No ramo `job.productId`, troque a busca de `conn` por
```ts
      const resolved =
        product.source !== 'MANUAL' ? await resolveConnection(job.tenantId, product.source) : null;
      const conn = resolved?.row ?? null;
      const affiliateSubId = resolved?.subId ?? null;
```
e aplique, em cada ramo, o mesmo padrão do Step 3 (`pattern = generateSubId(subIdPattern, { now: t, batchId: job.botId })`; Shopee com `composeLinkSubIds` e 4 argumentos; Awin/AliExpress com `.subId`; tags com `applyAffiliateTag`).

- [ ] **Step 5: `mirror-message.ts`**

Imports: `resolveConnections, isTenantActive` de `@afilados/db`; `composeLinkSubIds, applyAffiliateTag` de `@afilados/core`. Amplie o tipo `skipped` com `'tenant-inactive'` e, logo após `if (!rule || !rule.enabled) ...`:
```ts
  if (!(await isTenantActive(rule.tenantId))) return { outcome: 'skipped', reason: 'tenant-inactive' };
```
No `Promise.all`, troque `prisma.marketplaceConnection.findMany({ where: { tenantId } })` por `resolveConnections(tenantId)` (renomeie a variável para `connMap`) e apague `const connMap = new Map(...)`. No laço: `const resolved = connMap.get(kind); const conn = resolved?.row ?? null; const affiliateSubId = resolved?.subId ?? null;`. Shopee: `const pattern = generateSubId('{yyyyMMdd}-mirror-' + rule.id, {...});` + `const { subId, extraSubIds } = composeLinkSubIds('SHOPEE', affiliateSubId, pattern); adapter.toAffiliateLink(creds, storeLink.targetUrl, subId, extraSubIds)`. AliExpress: `.subId`. Tags: `const creds = applyAffiliateTag(decryptJson<TagCredentials>(...), affiliateSubId);`.

- [ ] **Step 6: Pré-aquecimento do ML**

Em `ml-links-prewarm.ts`, troque o default por `loadTagCredentialsForLink` (importe-o no lugar de `loadTagCredentials`): `(id) => loadTagCredentialsForLink(id, 'MERCADOLIVRE')`. Assim a chave do cache (`mlAffLinkKey(tenantId, tag, url)`) usa a mesma etiqueta do envio.

- [ ] **Step 7: Rodar o worker**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/worker && pnpm typecheck`
Expected: PASS (inclui `ml-links-prewarm.test.ts` e `ml-link-cache.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add apps/worker
git commit -m "feat(afiliados): links com SubID/tag do afiliado e bloqueio de tenant inativo no envio"
```

---

### Task 7: Agendadores e automações respeitam afiliados e tenant inativo

**Files:**
- Modify: `apps/worker/src/automation/awin-import-scheduler.ts` (~47), `apps/worker/src/automation/coupon-sync-scheduler.ts` (~43), `apps/worker/src/automation/scheduler.ts` (`tick`)
- Test: `apps/worker/test/awin-import-scheduler.test.ts`, `apps/worker/test/coupon-sync-scheduler.test.ts`, `apps/worker/test/automation-scheduler.test.ts`

**Interfaces:** Consumes `listTenantsWithCredentials` (Task 3).

- [ ] **Step 1: Testes que falham**

No teste de cada scheduler de Awin/cupons, acrescente um caso em que o tenant dono tem credencial, há um afiliado ativo e outro inativo, e o `enqueue` é chamado para dono + afiliado ativo (e não para o inativo). Modele no teste existente do arquivo (mesma forma de instanciar a classe e capturar `enqueue`); por exemplo, para Awin:
```ts
it('inclui afiliados ativos do dono e ignora inativos', async () => {
  const owner = await prisma.tenant.create({ data: { name: 'as-owner' } });
  const on = await prisma.tenant.create({ data: { name: 'as-on', parentTenantId: owner.id } });
  const off = await prisma.tenant.create({ data: { name: 'as-off', parentTenantId: owner.id, active: false } });
  try {
    await prisma.marketplaceConnection.create({
      data: { tenantId: owner.id, kind: 'AWIN', encryptedCredentials: encryptJson({ feedListUrl: 'https://ui.awin.com/feedList/x' }) },
    });
    const enqueued: string[] = [];
    const scheduler = new AwinImportScheduler(async (id: string) => { enqueued.push(id); });
    await scheduler.tick();
    expect(enqueued).toEqual(expect.arrayContaining([owner.id, on.id]));
    expect(enqueued).not.toContain(off.id);
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [on.id, off.id] } } });
    await prisma.tenant.deleteMany({ where: { id: owner.id } });
  }
});
```
(Adapte o construtor ao do arquivo de teste existente.) No `automation-scheduler.test.ts`, acrescente um caso: regra habilitada de tenant inativo não gera ação no `tick()` (siga o padrão do teste existente que verifica que uma regra habilitada é processada).

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/worker/test/awin-import-scheduler.test.ts apps/worker/test/coupon-sync-scheduler.test.ts apps/worker/test/automation-scheduler.test.ts`
Expected: FAIL nos novos casos.

- [ ] **Step 3: Implementar**

`awin-import-scheduler.ts`:
```ts
  async tick() {
    for (const tenantId of await listTenantsWithCredentials(['AWIN'])) {
      await this.enqueue(tenantId);
    }
  }
```
`coupon-sync-scheduler.ts`:
```ts
  async tick() {
    for (const tenantId of await listTenantsWithCredentials(['ALIEXPRESS', 'AWIN'])) {
      await this.enqueue(tenantId);
    }
  }
```
(importe `listTenantsWithCredentials` de `@afilados/db`; remova usos de `prisma` que ficarem sem referência). `scheduler.ts` `tick()`, antes do `for (const rule of this.rules) {`:
```ts
      const inactive = new Set(
        (await prisma.tenant.findMany({ where: { active: false }, select: { id: true } })).map((t) => t.id),
      );
```
e como primeira linha do corpo do laço: `if (inactive.has(rule.tenantId)) continue;`.

- [ ] **Step 4: Rodar o worker**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/worker && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(afiliados): agendadores incluem afiliados ativos e ignoram tenants inativos"
```

> **Limitação conhecida:** itens de lote cujo job foi descartado por `tenant-inactive` ficam `SCHEDULED` e não são reenfileirados sozinhos na reativação; o afiliado precisa reenviar/recriar esses lotes. Registrar isso no resumo final.

---

### Task 8: Sessão, login, papéis e `/me`

**Files:**
- Modify: `packages/shared/src/errors.ts`, `apps/api/src/lib/session.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/extension.ts` (`authenticateExtension`, ramo do token)
- Test: `apps/api/test/affiliate-auth.test.ts`

**Interfaces:**
- Produces:
  - `ApiError.forbidden(msg)` (403 `FORBIDDEN`); código `ACCOUNT_DISABLED`.
  - `createSession(userId, opts?: { impersonatorUserId?: string; ttlMs?: number })`, `validateSession(token): Promise<ValidSession | null>` com `{ user, tenantId, isAffiliate, impersonatorUserId, expiresAt }`, `ADMIN_SESSION_COOKIE`, `IMPERSONATION_TTL_MS`, `sessionCookieOptions(expires)`.
  - `req.isAffiliate: boolean`, `req.impersonatorUserId: string | null`; `requireSuperAdmin`, `forbidAffiliate` em `plugins/auth.ts`.
  - `/me` → `{ user: { ..., isSuperAdmin }, tenant, isAffiliate, impersonating: { by: string } | null }`.

- [ ] **Step 1: Teste que falha**

```ts
// apps/api/test/affiliate-auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
});
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('login e /me de afiliado', () => {
  it('/me marca isAffiliate e isSuperAdmin', async () => {
    const cookie = await loginCookie(app, aff.email, aff.password);
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).json();
    expect(me).toMatchObject({ isAffiliate: true, impersonating: null, user: { isSuperAdmin: false } });
  });
  it('tenant inativo: login 403 ACCOUNT_DISABLED e sessão antiga deixa de valer', async () => {
    const cookie = await loginCookie(app, aff.email, aff.password);
    await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: false } });
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: aff.email, password: aff.password },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('ACCOUNT_DISABLED');
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    await prisma.tenant.update({ where: { id: aff.tenantId }, data: { active: true } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api/test/affiliate-auth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Erros compartilhados**

Em `packages/shared/src/errors.ts` acrescente `'FORBIDDEN'` e `'ACCOUNT_DISABLED'` a `API_ERROR_CODES` e, na classe:
```ts
  static forbidden(msg = 'Sem permissão') {
    return new ApiError('FORBIDDEN', msg, 403);
  }
```

- [ ] **Step 4: `lib/session.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { prisma, type User } from '@afilados/db';
import { isProd } from '../config';

export const SESSION_COOKIE = 'afilados_session';
/** Guarda o token da sessão do SuperAdmin enquanto ele "entra como" um afiliado. */
export const ADMIN_SESSION_COOKIE = 'afilados_admin_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const IMPERSONATION_TTL_MS = 8 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions(expires: Date) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: isProd, path: '/', expires };
}

export async function createSession(
  userId: string,
  opts: { impersonatorUserId?: string; ttlMs?: number } = {},
) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? TTL_MS));
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      impersonatorUserId: opts.impersonatorUserId ?? null,
    },
  });
  return { token, expiresAt };
}

export interface ValidSession {
  user: User;
  tenantId: string;
  isAffiliate: boolean;
  impersonatorUserId: string | null;
  expiresAt: Date;
}

export async function validateSession(token: string): Promise<ValidSession | null> {
  const s = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { tenant: { select: { parentTenantId: true, active: true } } } } },
  });
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: s.id } });
    return null;
  }
  const { tenant, ...user } = s.user;
  // Conta desativada perde o acesso; só o SuperAdmin (sessão de impersonação) ainda entra.
  if (!tenant.active && !s.impersonatorUserId) return null;
  return {
    user,
    tenantId: user.tenantId,
    isAffiliate: tenant.parentTenantId !== null,
    impersonatorUserId: s.impersonatorUserId,
    expiresAt: s.expiresAt,
  };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
```

- [ ] **Step 5: `plugins/auth.ts`**

Declare `isAffiliate: boolean; impersonatorUserId: string | null;` em `FastifyRequest`; `app.decorateRequest('isAffiliate', false)` e `app.decorateRequest('impersonatorUserId', null)`; no hook, após `req.tenantId = s.tenantId;` acrescente `req.isAffiliate = s.isAffiliate; req.impersonatorUserId = s.impersonatorUserId;`. Ao final:
```ts
export async function requireSuperAdmin(req: FastifyRequest, _reply: FastifyReply) {
  if (!req.user) throw ApiError.unauthorized();
  if (!req.user.isSuperAdmin || req.impersonatorUserId) {
    throw ApiError.forbidden('Acesso restrito ao SuperAdmin');
  }
}

export async function forbidAffiliate(req: FastifyRequest, _reply: FastifyReply) {
  if (req.isAffiliate) {
    throw ApiError.forbidden('Indisponível para contas de afiliado: as credenciais são do administrador');
  }
}
```

- [ ] **Step 6: `routes/auth.ts` e `routes/me.ts`**

Login: depois de validar a senha e antes de criar a sessão:
```ts
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { active: true },
    });
    if (!tenant.active) throw new ApiError('ACCOUNT_DISABLED', 'Conta desativada', 403);
```
Use `sessionCookieOptions(expiresAt)` no `setCookie`. Logout: além do cookie atual, encerre a sessão de admin guardada:
```ts
    const adminToken = req.cookies[ADMIN_SESSION_COOKIE];
    if (adminToken) await destroySession(adminToken);
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
```
`me.ts`:
```ts
    const impersonator = req.impersonatorUserId
      ? await prisma.user.findUnique({ where: { id: req.impersonatorUserId }, select: { name: true } })
      : null;
    return {
      user: { id: u.id, email: u.email, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin },
      tenant: { id: tenant.id, name: tenant.name },
      isAffiliate: req.isAffiliate,
      impersonating: impersonator ? { by: impersonator.name } : null,
    };
```
`extension.ts` `authenticateExtension`, no ramo do token: antes do `return`, `if (!tokenRow.tenant.active) throw new ApiError('ACCOUNT_DISABLED', 'Conta desativada', 403);`.

- [ ] **Step 7: Rodar a API**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/api
git commit -m "feat(afiliados): sessão com impersonação, login de conta desativada e /me com papéis"
```

---

### Task 9: CRUD de afiliados e "entrar como"

**Files:**
- Create: `packages/shared/src/affiliates.ts`, `apps/api/src/routes/admin-affiliates.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/admin-affiliates.test.ts`

**Interfaces:**
- Produces (HTTP, prefixo `/api/v1/admin`):
  - `GET /affiliates` → `AffiliateRow[]` = `{ id, userId, name, email, active, createdAt, waConnected, groups, sends7d, subIds: Partial<Record<MarketplaceKind, string>> }`
  - `POST /affiliates` `{ name, email, password?, subIds? }` → 201 `AffiliateRow & { initialPassword?: string }`
  - `PATCH /affiliates/:id` `{ name?, email?, subIds? }` → `AffiliateRow`
  - `POST /affiliates/:id/active` `{ active }` → 204
  - `POST /affiliates/:id/reset-password` `{ password? }` → `{ password }`
  - `POST /affiliates/:id/impersonate` → 204 (cookies)
  - `POST /impersonation/stop` → 204

- [ ] **Step 1: Schemas**

`packages/shared/src/affiliates.ts` (exporte em `index.ts`: `export * from './affiliates';`):
```ts
import { z } from 'zod';

const id = () => z.string().trim().max(60).optional();
export const affiliateSubIdsSchema = z
  .object({
    SHOPEE: id(), ALIEXPRESS: id(), AWIN: id(), AMAZON: id(), MERCADOLIVRE: id(), MAGALU: id(),
  })
  .strict();

export const affiliateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(100).optional(),
  subIds: affiliateSubIdsSchema.optional(),
});
export const affiliateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  subIds: affiliateSubIdsSchema.optional(),
});
export const affiliateActiveSchema = z.object({ active: z.boolean() });
export const affiliateResetPasswordSchema = z.object({ password: z.string().min(8).max(100).optional() });
```

- [ ] **Step 2: Teste que falha**

```ts
// apps/api/test/admin-affiliates.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let admin: Awaited<ReturnType<typeof createTenantWithUser>>;
let adminCookie: string;
let plain: Awaited<ReturnType<typeof createTenantWithUser>>;
beforeAll(async () => {
  admin = await createTenantWithUser('admin');
  await prisma.user.update({ where: { id: admin.userId }, data: { isSuperAdmin: true } });
  plain = await createTenantWithUser('comum');
  adminCookie = await loginCookie(app, admin.email, admin.password);
});
afterAll(async () => {
  await cleanupTenant(admin.tenantId);
  await cleanupTenant(plain.tenantId);
  await app.close();
});

const email = () => `aff-${Math.random().toString(36).slice(2)}@test.local`;
const post = (url: string, payload: unknown, cookie = adminCookie) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload: payload as object });

describe('admin/affiliates', () => {
  it('sem login 401; usuário comum 403', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates' })).statusCode).toBe(401);
    const cookie = await loginCookie(app, plain.email, plain.password);
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates', headers: { cookie } });
    expect(r.statusCode).toBe(403);
  });

  it('cria afiliado com senha gerada, estrutura padrão e SubIDs; e-mail repetido → 409', async () => {
    const e = email();
    const r = await post('/admin/affiliates', { name: 'João', email: e, subIds: { SHOPEE: 'joao', AMAZON: 'joao-20' } });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.initialPassword).toBeTruthy();
    expect(body.subIds).toEqual({ SHOPEE: 'joao', AMAZON: 'joao-20' });
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: body.id } });
    expect(t.parentTenantId).toBe(admin.tenantId);
    expect(await prisma.template.count({ where: { tenantId: body.id, isDefault: true } })).toBe(1);
    expect(await prisma.operatingWindow.count({ where: { tenantId: body.id } })).toBe(1);
    await loginCookie(app, e, body.initialPassword);
    expect((await post('/admin/affiliates', { name: 'Outro', email: e })).statusCode).toBe(409);
  });

  it('lista, edita nome/SubIDs (vazio remove) e não enxerga afiliado de outro admin', async () => {
    const created = (await post('/admin/affiliates', { name: 'Maria', email: email(), password: 'senha-forte-1' })).json();
    const list = (await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates', headers: { cookie: adminCookie } })).json();
    expect(list.find((a: { id: string }) => a.id === created.id)).toMatchObject({ name: 'Maria', active: true, sends7d: 0 });
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/affiliates/${created.id}`, headers: { cookie: adminCookie },
      payload: { name: 'Maria S', subIds: { SHOPEE: 'maria' } },
    });
    expect(patch.json()).toMatchObject({ name: 'Maria S', subIds: { SHOPEE: 'maria' } });
    const clear = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/affiliates/${created.id}`, headers: { cookie: adminCookie },
      payload: { subIds: { SHOPEE: '' } },
    });
    expect(clear.json().subIds).toEqual({});
    const foreign = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/affiliates/${plain.tenantId}`, headers: { cookie: adminCookie },
      payload: { name: 'x' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('desativar derruba sessões e bloqueia login; reativar libera', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Pedro', email: e, password: 'senha-forte-1' })).json();
    const cookie = await loginCookie(app, e, 'senha-forte-1');
    expect((await post(`/admin/affiliates/${c.id}/active`, { active: false })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: e, password: 'senha-forte-1' } });
    expect(login.json().error.code).toBe('ACCOUNT_DISABLED');
    expect((await post(`/admin/affiliates/${c.id}/active`, { active: true })).statusCode).toBe(204);
    await loginCookie(app, e, 'senha-forte-1');
  });

  it('redefine a senha', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Ana', email: e, password: 'senha-forte-1' })).json();
    const r = await post(`/admin/affiliates/${c.id}/reset-password`, {});
    const { password } = r.json();
    await loginCookie(app, e, password);
    const old = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: e, password: 'senha-forte-1' } });
    expect(old.statusCode).toBe(401);
  });

  it('entrar como: /me mostra impersonating, /admin fica bloqueado, voltar restaura o admin', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Lia', email: e, password: 'senha-forte-1' })).json();
    const imp = await post(`/admin/affiliates/${c.id}/impersonate`, {});
    expect(imp.statusCode).toBe(204);
    const cookies = (imp.headers['set-cookie'] as string[]).map((s) => s.split(';')[0]!);
    const header = cookies.join('; ');
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: header } })).json();
    expect(me).toMatchObject({ tenant: { id: c.id }, impersonating: { by: expect.any(String) }, isAffiliate: true });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/affiliates', headers: { cookie: header } })).statusCode).toBe(403);
    const stop = await app.inject({ method: 'POST', url: '/api/v1/admin/impersonation/stop', headers: { cookie: header } });
    expect(stop.statusCode).toBe(204);
    const restored = (stop.headers['set-cookie'] as string[]).find((s) => s.startsWith('afilados_session=') && !s.startsWith('afilados_session=;'))!;
    const back = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: restored.split(';')[0]! } })).json();
    expect(back).toMatchObject({ tenant: { id: admin.tenantId }, impersonating: null });
  });

  it('isolamento: afiliado só vê os próprios templates', async () => {
    const e = email();
    const c = (await post('/admin/affiliates', { name: 'Iso', email: e, password: 'senha-forte-1' })).json();
    const cookie = await loginCookie(app, e, 'senha-forte-1');
    const r = (await app.inject({ method: 'GET', url: '/api/v1/templates', headers: { cookie } })).json();
    expect(JSON.stringify(r)).not.toContain(admin.tenantId);
    expect(c.id).not.toBe(admin.tenantId);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api/test/admin-affiliates.test.ts`
Expected: FAIL (rotas inexistentes → 404).

- [ ] **Step 4: Rotas**

`apps/api/src/routes/admin-affiliates.ts`:
```ts
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash } from '@node-rs/argon2';
import { prisma, DEFAULT_SETTINGS, DEFAULT_TEMPLATE, type MarketplaceKind } from '@afilados/db';
import {
  ApiError, MARKETPLACE_KINDS, affiliateActiveSchema, affiliateCreateSchema,
  affiliateResetPasswordSchema, affiliateUpdateSchema,
} from '@afilados/shared';
import { requireAuth, requireSuperAdmin } from '../plugins/auth';
import {
  ADMIN_SESSION_COOKIE, IMPERSONATION_TTL_MS, SESSION_COOKIE, createSession, destroySession,
  sessionCookieOptions, validateSession,
} from '../lib/session';

const idParam = z.object({ id: z.string().min(1) });
const generatePassword = () => randomBytes(9).toString('base64url');

async function loadAffiliate(adminTenantId: string, id: string) {
  const tenant = await prisma.tenant.findFirst({ where: { id, parentTenantId: adminTenantId } });
  if (!tenant) throw ApiError.notFound('Afiliado não encontrado');
  const user = await prisma.user.findFirst({
    where: { tenantId: id, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  });
  if (!user) throw ApiError.notFound('Afiliado sem usuário');
  return { tenant, user };
}

async function toRow(tenantId: string) {
  const [tenant, user, conns, wa, groups, sends] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.user.findFirstOrThrow({ where: { tenantId, role: 'OWNER' }, orderBy: { createdAt: 'asc' } }),
    prisma.marketplaceConnection.findMany({ where: { tenantId, subId: { not: null } }, select: { kind: true, subId: true } }),
    prisma.waSession.count({ where: { tenantId, status: 'CONNECTED' } }),
    prisma.waGroup.count({ where: { tenantId } }),
    prisma.sendLog.count({
      where: { tenantId, status: 'SENT', sentAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
  ]);
  return {
    id: tenant.id, userId: user.id, name: tenant.name, email: user.email, active: tenant.active,
    createdAt: tenant.createdAt, waConnected: wa > 0, groups, sends7d: sends,
    subIds: Object.fromEntries(conns.filter((c) => c.subId).map((c) => [c.kind, c.subId])),
  };
}

async function applySubIds(tenantId: string, subIds: Record<string, string | undefined> | undefined) {
  for (const [kind, raw] of Object.entries(subIds ?? {})) {
    if (raw === undefined || !MARKETPLACE_KINDS.includes(kind as MarketplaceKind)) continue;
    const value = raw.trim() || null;
    const existing = await prisma.marketplaceConnection.findFirst({
      where: { tenantId, kind: kind as MarketplaceKind },
    });
    if (existing) {
      await prisma.marketplaceConnection.update({ where: { id: existing.id }, data: { subId: value } });
    } else if (value) {
      await prisma.marketplaceConnection.create({
        data: { tenantId, kind: kind as MarketplaceKind, subId: value },
      });
    }
  }
}

export async function adminAffiliatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Voltar ao admin: sessão atual é a de impersonação, então não passa por requireSuperAdmin.
  app.post('/admin/impersonation/stop', async (req, reply) => {
    const adminToken = req.cookies[ADMIN_SESSION_COOKIE];
    const current = req.cookies[SESSION_COOKIE];
    if (!req.impersonatorUserId || !adminToken || !current) {
      throw ApiError.validation('Nenhuma sessão de impersonação ativa');
    }
    const admin = await validateSession(adminToken);
    if (!admin || admin.user.id !== req.impersonatorUserId) throw ApiError.unauthorized();
    await destroySession(current);
    reply.setCookie(SESSION_COOKIE, adminToken, sessionCookieOptions(admin.expiresAt));
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.register(async (admin) => {
    admin.addHook('preHandler', requireSuperAdmin);

    admin.get('/admin/affiliates', async (req) => {
      const tenants = await prisma.tenant.findMany({
        where: { parentTenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return Promise.all(tenants.map((t) => toRow(t.id)));
    });

    admin.post('/admin/affiliates', async (req, reply) => {
      const body = affiliateCreateSchema.parse(req.body);
      const email = body.email.toLowerCase();
      if (await prisma.user.findUnique({ where: { email } })) {
        throw ApiError.conflict('E-mail já cadastrado');
      }
      const password = body.password ?? generatePassword();
      const passwordHash = await hash(password);
      const tenantId = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: { name: body.name, parentTenantId: req.tenantId } });
        await tx.user.create({
          data: { tenantId: tenant.id, email, name: body.name, role: 'OWNER', passwordHash },
        });
        await tx.operatingWindow.create({ data: { tenantId: tenant.id } });
        await tx.template.create({
          data: { tenantId: tenant.id, name: 'Padrão', body: DEFAULT_TEMPLATE, isDefault: true },
        });
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
          await tx.setting.create({ data: { tenantId: tenant.id, key, value: value as object } });
        }
        return tenant.id;
      });
      await applySubIds(tenantId, body.subIds);
      const row = await toRow(tenantId);
      return reply.status(201).send(body.password ? row : { ...row, initialPassword: password });
    });

    admin.patch('/admin/affiliates/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      const body = affiliateUpdateSchema.parse(req.body);
      const { user } = await loadAffiliate(req.tenantId, id);
      if (body.email && body.email.toLowerCase() !== user.email) {
        const taken = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
        if (taken) throw ApiError.conflict('E-mail já cadastrado');
        await prisma.user.update({ where: { id: user.id }, data: { email: body.email.toLowerCase() } });
      }
      if (body.name) {
        await prisma.tenant.update({ where: { id }, data: { name: body.name } });
        await prisma.user.update({ where: { id: user.id }, data: { name: body.name } });
      }
      await applySubIds(id, body.subIds);
      return toRow(id);
    });

    admin.post('/admin/affiliates/:id/active', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { active } = affiliateActiveSchema.parse(req.body);
      await loadAffiliate(req.tenantId, id);
      await prisma.tenant.update({ where: { id }, data: { active } });
      if (!active) {
        await prisma.session.deleteMany({ where: { user: { tenantId: id }, impersonatorUserId: null } });
      }
      return reply.status(204).send();
    });

    admin.post('/admin/affiliates/:id/reset-password', async (req) => {
      const { id } = idParam.parse(req.params);
      const body = affiliateResetPasswordSchema.parse(req.body ?? {});
      const { user } = await loadAffiliate(req.tenantId, id);
      const password = body.password ?? generatePassword();
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(password) } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      return { password };
    });

    admin.post('/admin/affiliates/:id/impersonate', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const { user } = await loadAffiliate(req.tenantId, id);
      const adminToken = req.cookies[SESSION_COOKIE];
      if (!adminToken) throw ApiError.unauthorized();
      const adminSession = await validateSession(adminToken);
      if (!adminSession) throw ApiError.unauthorized();
      const { token, expiresAt } = await createSession(user.id, {
        impersonatorUserId: req.user!.id,
        ttlMs: IMPERSONATION_TTL_MS,
      });
      reply.setCookie(ADMIN_SESSION_COOKIE, adminToken, sessionCookieOptions(adminSession.expiresAt));
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
      return reply.status(204).send();
    });
  });
}
```
Registre em `apps/api/src/app.ts`: `import { adminAffiliatesRoutes } from './routes/admin-affiliates';` e `await api.register(adminAffiliatesRoutes);`. Em `packages/db/src/index.ts` garanta que `MarketplaceKind` é re-exportado (já vem de `@prisma/client`).

- [ ] **Step 5: Rodar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api
git commit -m "feat(afiliados): painel do SuperAdmin na API (CRUD, ativar, senha, entrar como)"
```

---

### Task 10: Bloqueios do afiliado, tela de Marketplaces e IA gerenciada na API

**Files:**
- Modify: `apps/api/src/routes/marketplaces.ts`, `apps/api/src/routes/extension.ts` (`/extension/session`), `apps/api/src/routes/ai-settings.ts`, `apps/api/src/lib/ai-settings.ts`, `packages/shared/src/ai.ts`
- Test: `apps/api/test/affiliate-restrictions.test.ts`

**Interfaces:**
- Consumes: `forbidAffiliate` (Task 8), `publicAffiliateConnection`, `setAffiliateSubId` (Task 4), `mergeAffiliateAi`, `getParentTenantId` (Task 3).
- Produces: `PUT /marketplaces/:kind` com `{ subId }` para afiliado; `GET /marketplaces` do afiliado com `subId`; `PublicAiSettings.managed` e `.available`.

- [ ] **Step 1: Teste que falha**

```ts
// apps/api/test/affiliate-restrictions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let owner: Awaited<ReturnType<typeof createTenantWithUser>>;
let aff: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
const call = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, ...(payload ? { payload: payload as object } : {}) });

beforeAll(async () => {
  owner = await createTenantWithUser('dono');
  aff = await createTenantWithUser('afiliado', owner.tenantId);
  await prisma.marketplaceConnection.create({
    data: { tenantId: owner.tenantId, kind: 'SHOPEE', status: 'OK', encryptedCredentials: encryptJson({ appId: 'x', secret: 'y' }) },
  });
  await prisma.setting.create({
    data: { tenantId: owner.tenantId, key: 'ai',
      value: { enabled: false, baseUrl: 'https://vps/v1', model: 'combo', encryptedApiKey: encryptJson({ apiKey: 'sk-test-1234' }).toString('base64') } },
  });
  cookie = await loginCookie(app, aff.email, aff.password);
});
afterAll(async () => {
  await cleanupTenant(owner.tenantId);
  await app.close();
});

describe('marketplaces do afiliado', () => {
  it('lista 6 lojas com status do dono, sem credenciais, e salva só subId', async () => {
    const put = await call('PUT', '/marketplaces/SHOPEE', { subId: ' joao ' });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ kind: 'SHOPEE', subId: 'joao', status: 'OK' });
    const list = (await call('GET', '/marketplaces')).json();
    expect(list).toHaveLength(6);
    const shopee = list.find((c: { kind: string }) => c.kind === 'SHOPEE');
    expect(shopee).toMatchObject({ subId: 'joao', hasSecret: false, appId: null });
  });
  it('rejeita campos de credencial (400) e rotas de credencial (403)', async () => {
    expect((await call('PUT', '/marketplaces/SHOPEE', { appId: 'x', secret: 'y' })).statusCode).toBe(400);
    expect((await call('POST', '/marketplaces/SHOPEE/check')).statusCode).toBe(403);
    expect((await call('POST', '/marketplaces/MERCADOLIVRE/session', { cookie: 'a=1' })).statusCode).toBe(403);
    expect((await call('POST', '/marketplaces/mercadolivre/oauth/start')).statusCode).toBe(403);
    expect((await call('POST', '/extension/session', { marketplaceKind: 'MERCADOLIVRE', cookies: { a: '1' } })).statusCode).toBe(403);
  });
});

describe('IA gerenciada', () => {
  it('GET esconde conexão e informa que está disponível', async () => {
    expect((await call('GET', '/settings/ai')).json()).toMatchObject({
      managed: true, available: true, baseUrl: '', model: '', hasApiKey: false,
    });
  });
  it('PUT aceita preferências, mas rejeita baseUrl/model/apiKey (403)', async () => {
    const ok = await call('PUT', '/settings/ai', { tone: 'urgente', enabled: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tone: 'urgente', enabled: true });
    expect((await call('PUT', '/settings/ai', { baseUrl: 'https://x' })).statusCode).toBe(403);
    expect((await call('PUT', '/settings/ai', { apiKey: 'sk-x' })).statusCode).toBe(403);
    const ownRow = await prisma.setting.findFirstOrThrow({ where: { tenantId: aff.tenantId, key: 'ai' } });
    expect(ownRow.value).not.toHaveProperty('baseUrl', 'https://x');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api/test/affiliate-restrictions.test.ts`
Expected: FAIL.

- [ ] **Step 3: `routes/marketplaces.ts`**

Importe `forbidAffiliate` (de `../plugins/auth`), `resolveConnections` (de `@afilados/db`), `publicAffiliateConnection`, `setAffiliateSubId` (de `../lib/marketplaces`). No `GET /marketplaces`, antes do código atual:
```ts
    if (req.isAffiliate) {
      const [owner, own] = await Promise.all([
        resolveConnections(req.tenantId),
        req.db.marketplaceConnection.findMany(),
      ]);
      return MARKETPLACE_KINDS.map((kind) =>
        publicAffiliateConnection(
          owner.get(kind)?.row ?? null,
          own.find((r) => r.kind === kind) ?? null,
          kind,
        ),
      );
    }
```
No `PUT /marketplaces/:kind`, logo após `const { kind } = kindParams.parse(req.params);`:
```ts
    if (req.isAffiliate) {
      const { subId } = z.object({ subId: z.string().trim().max(60) }).strict().parse(req.body);
      await setAffiliateSubId(req.db, kind, subId);
      const [owner, own] = await Promise.all([
        resolveConnections(req.tenantId),
        req.db.marketplaceConnection.findFirst({ where: { kind } }),
      ]);
      return publicAffiliateConnection(owner.get(kind)?.row ?? null, own, kind);
    }
```
Passe `{ preHandler: forbidAffiliate }` como segundo argumento em `app.post('/marketplaces/:kind/check', …)`, `app.post('/marketplaces/:kind/session', …)`, `app.post('/marketplaces/mercadolivre/oauth/start', …)`, `…/oauth/callback`, `app.delete('/marketplaces/mercadolivre/oauth', …)` e `app.get('/marketplaces/awin/feeds', …)`.
`routes/extension.ts` em `POST /extension/session`: depois de `authenticateExtension`, `if (await getParentTenantId(tenantId)) throw ApiError.forbidden('Sessões de marketplace são gerenciadas pelo administrador');` (importe `getParentTenantId` de `@afilados/db`).

- [ ] **Step 4: IA**

`packages/shared/src/ai.ts`: em `PublicAiSettings` acrescente `managed: boolean; available: boolean;`.
`apps/api/src/lib/ai-settings.ts`: importe `mergeAffiliateAi, getParentTenantId, prisma` de `@afilados/db`; troque `toPublicAi` e acrescente os helpers:
```ts
export function toPublicAi(s: StoredAiConfig, managed = false): PublicAiSettings {
  const key = readApiKey(s);
  const available = Boolean(s.baseUrl && s.model && s.encryptedApiKey);
  return {
    enabled: s.enabled,
    baseUrl: managed ? '' : s.baseUrl,
    model: managed ? '' : s.model,
    hasApiKey: managed ? false : Boolean(s.encryptedApiKey),
    apiKeyHint: managed ? null : s.encryptedApiKey ? `••••${key ? key.slice(-4) : ''}` : null,
    extraInstructions: s.extraInstructions ?? AI_DEFAULTS.extraInstructions,
    tone: s.tone ?? AI_DEFAULTS.tone,
    emojiLevel: s.emojiLevel ?? AI_DEFAULTS.emojiLevel,
    maxChars: s.maxChars ?? AI_DEFAULTS.maxChars,
    temperature: s.temperature ?? AI_DEFAULTS.temperature,
    managed,
    available,
  };
}

/** Configuração efetiva: afiliado recebe as credenciais de IA do tenant pai. */
export async function effectiveAi(db: TenantClient, own: StoredAiConfig): Promise<StoredAiConfig> {
  const parentId = await getParentTenantId(db.$tenantId);
  if (!parentId) return own;
  const row = await prisma.setting.findFirst({ where: { tenantId: parentId, key: AI_KEY } });
  return mergeAffiliateAi(own, row?.value as StoredAiConfig | undefined);
}
```
`routes/ai-settings.ts`: importe `effectiveAi`; acrescente
```ts
function rejectCredentials(isAffiliate: boolean, patch: Record<string, unknown>) {
  if (isAffiliate && (patch.baseUrl !== undefined || patch.model !== undefined || patch.apiKey !== undefined)) {
    throw ApiError.forbidden('A conexão de IA é gerenciada pelo administrador');
  }
}
```
`GET`: `const own = await loadStoredAi(req.db); return toPublicAi(await effectiveAi(req.db, own), req.isAffiliate);`.
`PUT`: após o `parse`, `rejectCredentials(req.isAffiliate, patch);`; `const next = applyPatch(await loadStoredAi(req.db), patch);` mantenha, mas `if (next.baseUrl && !req.isAffiliate) await assertSafeBaseUrl(next.baseUrl);` e `if (next.enabled) assertComplete(await effectiveAi(req.db, next), 'Para ativar');`; salve `next` (só o próprio); retorne `toPublicAi(await effectiveAi(req.db, next), req.isAffiliate)`.
`POST /settings/ai/test`: `rejectCredentials(req.isAffiliate, draft);` e `const merged = await effectiveAi(req.db, applyPatch(await loadStoredAi(req.db), draft));`.

- [ ] **Step 5: Rodar**

Run: `set -a && . ./.env && set +a && pnpm vitest run apps/api && pnpm typecheck`
Expected: PASS (inclui `ai-settings.test.ts` e `marketplaces.test.ts` existentes).

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api
git commit -m "feat(afiliados): afiliado só edita SubID; IA e credenciais gerenciadas pelo admin"
```

---

### Task 11: Web — tipos, queries, menu e faixa de impersonação

**Files:**
- Modify: `apps/web/src/lib/types.ts`, `apps/web/src/lib/queries.ts`, `apps/web/src/components/app-shell/sidebar.tsx`, `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/components/app-shell/impersonation-banner.tsx`
- Test: `apps/web/test/impersonation-banner.test.tsx`

**Interfaces:**
- Produces: `Me` com `user.isSuperAdmin`, `isAffiliate`, `impersonating: { by: string } | null`; `AffiliateRow`; `useAffiliates()`; `<ImpersonationBanner />`.

- [ ] **Step 1: Teste que falha**

```tsx
// apps/web/test/impersonation-banner.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationBanner } from '@/components/app-shell/impersonation-banner';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ImpersonationBanner /></QueryClientProvider>);
}
beforeEach(() => apiFetchMock.mockReset());

describe('ImpersonationBanner', () => {
  it('não aparece fora da impersonação', async () => {
    apiFetchMock.mockResolvedValue({ user: { name: 'Fulano', isSuperAdmin: false }, tenant: { name: 'T' }, isAffiliate: true, impersonating: null });
    renderBanner();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/acessando como/i)).toBeNull();
  });
  it('mostra o nome e volta ao admin', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    apiFetchMock.mockImplementation(async (path: string) =>
      path === '/me'
        ? { user: { name: 'Fulano' }, tenant: { name: 'Loja do Fulano' }, isAffiliate: true, impersonating: { by: 'Admin' } }
        : undefined,
    );
    renderBanner();
    expect(await screen.findByText(/acessando como/i)).toHaveTextContent('Loja do Fulano');
    fireEvent.click(screen.getByRole('button', { name: /voltar ao admin/i }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/admin/impersonation/stop', { method: 'POST' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/afiliados'));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/web/test/impersonation-banner.test.tsx`
Expected: FAIL (componente inexistente).

- [ ] **Step 3: Implementar**

`types.ts`: substitua `Me` por
```ts
export interface Me {
  user: { id: string; email: string; name: string; role: string; isSuperAdmin: boolean };
  tenant: { id: string; name: string };
  isAffiliate: boolean;
  impersonating: { by: string } | null;
}
```
acrescente `subId?: string | null;` em `MarketplaceConnection`, `managed?: boolean; available?: boolean;` em `AiSettings` e:
```ts
export interface AffiliateRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  waConnected: boolean;
  groups: number;
  sends7d: number;
  subIds: Partial<Record<MarketplaceKind, string>>;
}
```
`queries.ts` (importe `AffiliateRow`):
```ts
export const useAffiliates = (enabled = true) =>
  useQuery({ queryKey: ['admin', 'affiliates'], enabled, queryFn: () => apiFetch<AffiliateRow[]>('/admin/affiliates') });
```
`impersonation-banner.tsx`:
```tsx
'use client';
import { apiFetch } from '@/lib/api';
import { useMe } from '@/lib/queries';

export function ImpersonationBanner() {
  const { data: me } = useMe();
  if (!me?.impersonating) return null;
  async function back() {
    await apiFetch('/admin/impersonation/stop', { method: 'POST' });
    window.location.assign('/afiliados');
  }
  return (
    <div className="flex items-center justify-center gap-3 bg-amber-500/20 px-4 py-2 text-sm text-amber-200">
      <span>
        Acessando como <strong>{me.tenant.name}</strong>
      </span>
      <button type="button" onClick={back} className="rounded-md border border-amber-400/50 px-2 py-0.5 hover:bg-amber-500/20">
        Voltar ao admin
      </button>
    </div>
  );
}
```
`layout.tsx`: importe e renderize `<ImpersonationBanner />` como primeiro filho de `<div className="flex flex-1 flex-col">`. `sidebar.tsx`: `import { useMe } from '@/lib/queries';`, em `Sidebar()` `const { data: me } = useMe();` e `const principal = PRINCIPAL.filter((i) => i.href !== '/afiliados' || me?.user.isSuperAdmin);`, usando `items={principal}`.

- [ ] **Step 4: Rodar**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(afiliados): faixa de impersonação, menu Afiliados só para SuperAdmin e tipos"
```

---

### Task 12: Web — página Afiliados (SuperAdmin)

**Files:**
- Modify: `apps/web/src/app/(app)/afiliados/page.tsx`
- Create: `apps/web/src/components/affiliates/affiliates-client.tsx`, `apps/web/src/components/affiliates/affiliate-form-dialog.tsx`, `apps/web/src/components/marketplaces/affiliate-subid-fields.ts`
- Test: `apps/web/test/affiliates-page.test.tsx`

**Interfaces:**
- Consumes: `useMe`, `useAffiliates`, `AffiliateRow`, `useApiMutation`, UI `Table*`, `Dialog*`, `Button`, `Input`, `Label`.
- Produces: `AFFILIATE_SUBID_FIELDS: Record<MarketplaceKind, { label: string; help: string }>` (reusado na Task 13).

- [ ] **Step 1: Teste que falha**

```tsx
// apps/web/test/affiliates-page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AffiliatesClient } from '@/components/affiliates/affiliates-client';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const row = {
  id: 'a1', userId: 'u1', name: 'João', email: 'joao@x.com', active: true,
  createdAt: '2026-10-16T10:00:00.000Z', waConnected: true, groups: 3, sends7d: 12,
  subIds: { SHOPEE: 'joao' },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AffiliatesClient /></QueryClientProvider>);
}
beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/me') return { user: { isSuperAdmin: true }, tenant: {}, isAffiliate: false, impersonating: null };
    if (path === '/admin/affiliates') return [row];
    return undefined;
  });
});

describe('AffiliatesClient', () => {
  it('lista afiliados com métricas', async () => {
    renderPage();
    expect(await screen.findByText('João')).toBeInTheDocument();
    expect(screen.getByText('joao@x.com')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
  it('desativa um afiliado', async () => {
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /desativar/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates/a1/active', { method: 'POST', json: { active: false } }),
    );
  });
  it('entra como o afiliado', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /entrar como/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates/a1/impersonate', { method: 'POST' }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });
  it('cria afiliado e mostra a senha gerada uma vez', async () => {
    apiFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/me') return { user: { isSuperAdmin: true }, tenant: {}, isAffiliate: false, impersonating: null };
      if (path === '/admin/affiliates' && init?.method === 'POST') return { ...row, id: 'a2', initialPassword: 'Senha123gerada' };
      if (path === '/admin/affiliates') return [row];
      return undefined;
    });
    renderPage();
    await screen.findByText('João');
    fireEvent.click(screen.getByRole('button', { name: /novo afiliado/i }));
    fireEvent.change(await screen.findByLabelText(/nome/i), { target: { value: 'Nova' } });
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'nova@x.com' } });
    fireEvent.change(screen.getByLabelText(/subid.*shopee|shopee/i), { target: { value: 'nova' } });
    fireEvent.click(screen.getByRole('button', { name: /criar afiliado/i }));
    expect(await screen.findByText('Senha123gerada')).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith('/admin/affiliates', {
      method: 'POST',
      json: { name: 'Nova', email: 'nova@x.com', subIds: { SHOPEE: 'nova' } },
    });
  });
  it('não-SuperAdmin vê aviso', async () => {
    apiFetchMock.mockImplementation(async (path: string) =>
      path === '/me' ? { user: { isSuperAdmin: false }, tenant: {}, isAffiliate: false, impersonating: null } : [],
    );
    renderPage();
    expect(await screen.findByText(/restrita ao superadmin/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/web/test/affiliates-page.test.tsx`
Expected: FAIL (componentes inexistentes).

- [ ] **Step 3: Campos de SubID (compartilhado)**

`apps/web/src/components/marketplaces/affiliate-subid-fields.ts`:
```ts
import type { MarketplaceKind } from '@afilados/shared';

export const AFFILIATE_SUBID_FIELDS: Record<MarketplaceKind, { label: string; help: string }> = {
  SHOPEE: { label: 'SubID', help: 'Identifica as vendas do afiliado na Shopee. Só letras e números.' },
  ALIEXPRESS: { label: 'SubID', help: 'Enviado como sub_id nos links do AliExpress. Só letras e números.' },
  AWIN: { label: 'SubID', help: 'Enviado como clickref nos links da Awin. Só letras e números.' },
  AMAZON: { label: 'Tracking ID', help: 'Tracking ID criado na conta Amazon do administrador (ex.: nome-20).' },
  MERCADOLIVRE: { label: 'Etiqueta', help: 'Etiqueta de afiliado criada na conta do administrador.' },
  MAGALU: { label: 'Loja', help: 'Nome da loja no Magazine Você. Em branco, usa a loja do administrador.' },
};
```

- [ ] **Step 4: Dialog de criação/edição**

`affiliate-form-dialog.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MARKETPLACE_CONFIGS } from '@/components/marketplaces/marketplace-config';
import { AFFILIATE_SUBID_FIELDS } from '@/components/marketplaces/affiliate-subid-fields';
import type { AffiliateRow } from '@/lib/types';

export interface AffiliatePayload {
  name: string;
  email: string;
  password?: string;
  subIds: Partial<Record<MarketplaceKind, string>>;
}

export function AffiliateFormDialog({
  open, onOpenChange, initial, pending, onSubmit, createdPassword,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: AffiliateRow;
  pending?: boolean;
  onSubmit: (p: AffiliatePayload) => void;
  /** Senha gerada, exibida uma única vez depois da criação. */
  createdPassword?: string | null;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [subIds, setSubIds] = useState<Partial<Record<MarketplaceKind, string>>>(initial?.subIds ?? {});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = Object.fromEntries(
      Object.entries(subIds).filter(([k, v]) => (initial ? true : Boolean(v?.trim())) && MARKETPLACE_KINDS.includes(k as MarketplaceKind)),
    ) as Partial<Record<MarketplaceKind, string>>;
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      ...(password && !initial ? { password } : {}),
      subIds: clean,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Editar afiliado' : 'Novo afiliado'}</DialogTitle>
          <DialogDescription>
            O afiliado usa as suas APIs; aqui você cadastra só o identificador dele em cada plataforma.
          </DialogDescription>
        </DialogHeader>
        {createdPassword ? (
          <div className="grid gap-2 text-sm">
            <p>Afiliado criado. Anote a senha inicial — ela só é exibida agora:</p>
            <code className="rounded-md border border-border bg-surface px-3 py-2 text-base">{createdPassword}</code>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <div>
              <Label htmlFor="aff-name">Nome</Label>
              <Input id="aff-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="aff-email">E-mail</Label>
              <Input id="aff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {!initial && (
              <div>
                <Label htmlFor="aff-pass">Senha inicial</Label>
                <Input id="aff-pass" type="password" autoComplete="new-password" placeholder="Em branco = gerar automaticamente" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            <fieldset className="grid gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Identificadores por plataforma</legend>
              {MARKETPLACE_KINDS.map((kind) => {
                const f = AFFILIATE_SUBID_FIELDS[kind];
                const label = `${f.label} ${MARKETPLACE_CONFIGS[kind].label}`;
                return (
                  <div key={kind}>
                    <Label htmlFor={`aff-sub-${kind}`}>{label}</Label>
                    <Input id={`aff-sub-${kind}`} value={subIds[kind] ?? ''} onChange={(e) => setSubIds({ ...subIds, [kind]: e.target.value })} />
                  </div>
                );
              })}
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={pending}>{initial ? 'Salvar' : 'Criar afiliado'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```
(`MARKETPLACE_CONFIGS[kind].label` para Shopee deve conter "Shopee"; o teste localiza o campo por `/shopee/i`. Se o label da config divergir, ajuste a regex do teste, não o componente.)

- [ ] **Step 5: Cliente da página e rota**

`affiliates-client.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import { useAffiliates, useMe } from '@/lib/queries';
import type { AffiliateRow } from '@/lib/types';
import { AffiliateFormDialog, type AffiliatePayload } from './affiliate-form-dialog';

export function AffiliatesClient() {
  const { data: me } = useMe();
  const isAdmin = me?.user.isSuperAdmin === true;
  const { data: rows = [] } = useAffiliates(isAdmin);
  const [editing, setEditing] = useState<AffiliateRow | 'new' | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{ name: string; password: string } | null>(null);

  const save = useApiMutation(
    (p: AffiliatePayload) =>
      editing && editing !== 'new'
        ? apiFetch<AffiliateRow>(`/admin/affiliates/${editing.id}`, { method: 'PATCH', json: p })
        : apiFetch<AffiliateRow & { initialPassword?: string }>('/admin/affiliates', { method: 'POST', json: p }),
    {
      invalidate: [['admin', 'affiliates']],
      onSuccess: (out) => {
        const pwd = (out as { initialPassword?: string }).initialPassword;
        if (pwd) setCreatedPassword(pwd);
        else setEditing(null);
      },
    },
  );
  const toggle = useApiMutation(
    (a: AffiliateRow) =>
      apiFetch(`/admin/affiliates/${a.id}/active`, { method: 'POST', json: { active: !a.active } }),
    { invalidate: [['admin', 'affiliates']], success: 'Status atualizado' },
  );
  const reset = useApiMutation(
    (a: AffiliateRow) =>
      apiFetch<{ password: string }>(`/admin/affiliates/${a.id}/reset-password`, { method: 'POST', json: {} }),
    { onSuccess: (out, a) => setResetResult({ name: a.name, password: out.password }) },
  );
  const impersonate = useApiMutation(
    (a: AffiliateRow) => apiFetch(`/admin/affiliates/${a.id}/impersonate`, { method: 'POST' }),
    { onSuccess: () => window.location.assign('/') },
  );

  if (me && !isAdmin) {
    return <p className="text-sm text-muted-foreground">Área restrita ao SuperAdmin.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Afiliados</h1>
          <p className="text-sm text-muted-foreground">
            Contas que usam as suas APIs, com WhatsApp, grupos e fila próprios.
          </p>
        </div>
        <Button onClick={() => { setCreatedPassword(null); setEditing('new'); }}>Novo afiliado</Button>
      </div>

      {resetResult && (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm">
          Nova senha de {resetResult.name}: <code>{resetResult.password}</code> (exibida só agora).
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>WhatsApp</TableHead>
            <TableHead>Grupos</TableHead>
            <TableHead>Envios 7d</TableHead>
            <TableHead>Criado em</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.name}</TableCell>
              <TableCell>{a.email}</TableCell>
              <TableCell>{a.active ? 'Ativo' : 'Desativado'}</TableCell>
              <TableCell>{a.waConnected ? 'Conectado' : '—'}</TableCell>
              <TableCell>{a.groups}</TableCell>
              <TableCell>{a.sends7d}</TableCell>
              <TableCell>{formatDateTime(a.createdAt)}</TableCell>
              <TableCell className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => impersonate.mutate(a)}>Entrar como</Button>
                <Button size="sm" variant="outline" onClick={() => { setCreatedPassword(null); setEditing(a); }}>Editar</Button>
                <Button size="sm" variant="outline" onClick={() => toggle.mutate(a)}>{a.active ? 'Desativar' : 'Ativar'}</Button>
                <Button size="sm" variant="outline" onClick={() => reset.mutate(a)}>Redefinir senha</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {editing && (
        <AffiliateFormDialog
          key={editing === 'new' ? 'new' : editing.id}
          open
          onOpenChange={(v) => { if (!v) { setEditing(null); setCreatedPassword(null); } }}
          {...(editing !== 'new' ? { initial: editing } : {})}
          pending={save.isPending}
          onSubmit={(p) => save.mutate(p)}
          createdPassword={createdPassword}
        />
      )}
    </div>
  );
}
```
`afiliados/page.tsx`:
```tsx
import { AffiliatesClient } from '@/components/affiliates/affiliates-client';

export default function Page() {
  return <AffiliatesClient />;
}
```
Confirme que `formatDateTime` existe em `@/lib/format` (usado em `marketplaces-client.tsx`) e que `Button` aceita `size="sm"`; se não, remova o `size`.

- [ ] **Step 6: Rodar**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS. Se o `Dialog` (base-ui) atrapalhar o teste de criação no jsdom, mantenha o componente e ajuste só as consultas do teste (por exemplo `findByRole('dialog')` + `within`), sem trocar a UI.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(afiliados): página de gestão de afiliados do SuperAdmin"
```

---

### Task 13: Web — Marketplaces e IA do afiliado

**Files:**
- Create: `apps/web/src/components/marketplaces/affiliate-marketplaces.tsx`
- Modify: `apps/web/src/app/(app)/marketplaces/marketplaces-client.tsx`, `apps/web/src/components/settings/ai-settings-form.tsx`
- Test: `apps/web/test/affiliate-marketplaces.test.tsx`, `apps/web/test/ai-settings-form.test.tsx` (caso novo)

**Interfaces:** Consumes `AFFILIATE_SUBID_FIELDS` (Task 12), `useMarketplaces`, `useMe`.

- [ ] **Step 1: Testes que falham**

```tsx
// apps/web/test/affiliate-marketplaces.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AffiliateMarketplaces } from '@/components/marketplaces/affiliate-marketplaces';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const kinds = ['SHOPEE', 'MERCADOLIVRE', 'AMAZON', 'MAGALU', 'AWIN', 'ALIEXPRESS'];
const list = kinds.map((kind) => ({ kind, status: 'OK', subId: kind === 'SHOPEE' ? 'joao' : null }));

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => (path === '/marketplaces' ? list : { ok: true }));
});
function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AffiliateMarketplaces /></QueryClientProvider>);
}

describe('AffiliateMarketplaces', () => {
  it('mostra um campo por plataforma, sem credenciais, e avisa quando falta o identificador', async () => {
    renderIt();
    expect(await screen.findAllByRole('textbox')).toHaveLength(6);
    expect((screen.getByLabelText(/subid.*shopee/i) as HTMLInputElement).value).toBe('joao');
    expect(screen.queryByLabelText(/secret|app id|senha/i)).toBeNull();
    expect(screen.getAllByText(/não será atribuída a você/i).length).toBe(5);
  });
  it('salva o identificador de uma plataforma', async () => {
    renderIt();
    const input = await screen.findByLabelText(/tracking id.*amazon/i);
    fireEvent.change(input, { target: { value: 'joao-20' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar amazon/i }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/marketplaces/AMAZON', { method: 'PUT', json: { subId: 'joao-20' } }),
    );
  });
});
```
Em `apps/web/test/ai-settings-form.test.tsx` acrescente (usa `value`, `render`, `screen`, `fireEvent`, `waitFor`, `vi` já importados):
```tsx
  it('IA gerenciada: esconde conexão e nunca envia baseUrl/model/apiKey', async () => {
    const onSave = vi.fn();
    const onTest = vi.fn(async (_d?: AiSettingsPatch) => ({ cta: 'x', latencyMs: 1 }));
    render(<AiSettingsForm value={{ ...value, baseUrl: '', model: '', hasApiKey: false, apiKeyHint: null, managed: true, available: true }} onSave={onSave} onTest={onTest} />);
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /testar/i }));
    await waitFor(() => expect(onTest).toHaveBeenCalled());
    const draft = onTest.mock.calls[0]![0]!;
    expect(draft).not.toHaveProperty('baseUrl');
    expect(draft).not.toHaveProperty('model');
    expect(draft).not.toHaveProperty('apiKey');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run apps/web/test/affiliate-marketplaces.test.tsx apps/web/test/ai-settings-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `affiliate-marketplaces.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/app-shell/status-pill';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useMarketplaces } from '@/lib/queries';
import { MARKETPLACE_CONFIGS } from './marketplace-config';
import { AFFILIATE_SUBID_FIELDS } from './affiliate-subid-fields';

function Row({ kind, saved }: { kind: MarketplaceKind; saved: string }) {
  const [value, setValue] = useState(saved);
  const f = AFFILIATE_SUBID_FIELDS[kind];
  const name = MARKETPLACE_CONFIGS[kind].label;
  const save = useApiMutation(
    (subId: string) => apiFetch(`/marketplaces/${kind}`, { method: 'PUT', json: { subId } }),
    { invalidate: [['marketplaces']], success: `${name} salvo` },
  );
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Label htmlFor={`sub-${kind}`}>{`${f.label} ${name}`}</Label>
      <div className="mt-1 flex gap-2">
        <Input id={`sub-${kind}`} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="button" onClick={() => save.mutate(value)} disabled={save.isPending} aria-label={`Salvar ${name}`}>
          Salvar
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>
      {!saved.trim() && (
        <p className="mt-1 text-xs text-amber-500">
          Sem identificador, a comissão deste marketplace não será atribuída a você.
        </p>
      )}
    </div>
  );
}

export function AffiliateMarketplaces() {
  const { data = [] } = useMarketplaces();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marketplaces</h1>
        <p className="text-sm text-muted-foreground">
          As APIs são do administrador. Informe só o seu identificador em cada plataforma.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETPLACE_KINDS.map((kind) => {
          const conn = data.find((m) => m.kind === kind);
          return (
            <div key={kind} className="space-y-2">
              <StatusPill label={MARKETPLACE_CONFIGS[kind].label} status={conn?.status ?? 'UNCONFIGURED'} />
              <Row key={`${kind}-${conn?.subId ?? ''}`} kind={kind} saved={conn?.subId ?? ''} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```
Em `marketplaces-client.tsx`: renomeie a função existente para `RootMarketplaces` (sem export) e acrescente
```tsx
export function MarketplacesClient() {
  const { data: me } = useMe();
  if (me?.isAffiliate) return <AffiliateMarketplaces />;
  return <RootMarketplaces />;
}
```
importando `useMe` de `@/lib/queries` e `AffiliateMarketplaces`.

- [ ] **Step 4: IA gerenciada no form**

Em `ai-settings-form.tsx`: `const managed = value.managed === true;`. `draft()`:
```ts
    const { apiKey, baseUrl, model, ...rest } = form;
    return {
      ...rest,
      ...(managed ? {} : { baseUrl, model }),
      ...(apiKey.trim() && !managed ? { apiKey: apiKey.trim() } : {}),
    };
```
Troque o `<fieldset>` "Conexão (9Router)" por `{managed ? <p className="text-sm text-muted-foreground">{value.available ? 'A conexão de IA é gerenciada pelo administrador.' : 'A IA ainda não foi configurada pelo administrador.'}</p> : (<fieldset ...>…existente…</fieldset>)}` e, no `Switch` de ativar, `disabled={managed && !value.available}`.

- [ ] **Step 5: Rodar**

Run: `pnpm vitest run apps/web && pnpm typecheck`
Expected: PASS (testes antigos do form seguem verdes: `managed` indefinido = comportamento atual).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(afiliados): Marketplaces com campo único de SubID e IA gerenciada na web"
```

---

### Task 14: Verificação final, documentação e smoke manual

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-10-16-afiliados-saas-design.md` (status)

- [ ] **Step 1: Suíte completa**

Run: `set -a && . ./.env && set +a && pnpm typecheck && pnpm lint && pnpm test`
Expected: tudo verde. Se `pnpm lint` (prettier) reclamar só dos arquivos novos, rode `pnpm exec prettier --write` neles.

- [ ] **Step 2: README**

Acrescente em `README.md` uma seção "Afiliados":
```md
## Afiliados

O usuário marcado como SuperAdmin (`admin@dudurochatec.com` na migração; o usuário do seed em instalações novas) cria afiliados em **Afiliados** no painel. Cada afiliado é um tenant filho: tem login próprio e WhatsApp, grupos, fila, lotes e extensão separados, mas usa as credenciais de marketplace e a chave de IA do SuperAdmin. Em **Marketplaces** o afiliado informa só o SubID/tracking ID/etiqueta/loja de cada plataforma. Desativar um afiliado bloqueia login e envios; reativar libera. "Entrar como" abre a conta do afiliado com uma faixa "Voltar ao admin".
```
No spec, troque a linha `**Status:**` por `**Status:** aprovado; plano em docs/superpowers/plans/2026-10-16-afiliados-saas.md`.

- [ ] **Step 3: Smoke manual (app rodando)**

Com `docker compose up -d --wait` e `pnpm dev`: entrar como SuperAdmin → Afiliados → criar afiliado com SubID Shopee → "Entrar como" → conferir faixa, Marketplaces com 6 campos e IA sem URL/chave → "Voltar ao admin" → desativar e tentar logar como o afiliado (deve falhar com "Conta desativada").

- [ ] **Step 4: Commit**

```bash
git add README.md docs
git commit -m "docs(afiliados): README e status do spec"
```

---

## Self-Review

**Cobertura do spec:** modelo de dados (T1), resolvedor e herança de IA (T3), leitura em API/worker (T4–T5), geração de link por plataforma e fallback sem SubID (T2, T6), agendadores e tenant inativo (T6–T7), login/papéis/impersonação (T8–T9), bloqueios e IA gerenciada (T10), telas (T11–T13), testes de isolamento (T4, T9, T10). As fases do spec correspondem a T1–T7 (fase 1), T8–T10 e T12 (fase 2), T9 e T11 (fase 3) e T6, T10 e T13 (fase 4).

**Pontos que o executor deve confirmar ao implementar:** os números de linha citados são aproximados; os trechos antes/depois são a referência. Os testes de scheduler (T7) e o de criação via Dialog (T12) dependem do formato dos testes e do componente existentes e podem exigir ajuste de construção/consultas, não de comportamento.

**Consistência de nomes:** `resolveConnection(s)`, `resolveSettings`, `mergeAffiliateAi`, `isTenantActive`, `listTenantsWithCredentials`, `composeLinkSubIds`, `applyAffiliateTag`, `loadTagCredentialsForLink`, `publicAffiliateConnection`, `setAffiliateSubId`, `requireSuperAdmin`, `forbidAffiliate`, `AFFILIATE_SUBID_FIELDS` mantêm a mesma assinatura em todas as tarefas.

**Limitação registrada:** jobs de envio descartados por `tenant-inactive` não são reenfileirados na reativação (T7).
