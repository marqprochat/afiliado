# F2 — Espelhamento de Grupos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espelhar ofertas de grupos de terceiros para os grupos do usuário em tempo real, trocando links por links de afiliado (Shopee via API; Amazon/ML/Magalu via parâmetros na URL), com dedup, modos Clone/Template, logs e UI.

**Architecture:** O `BaileysGateway` passa a expor mensagens recebidas; um `MirrorListener` no worker casa cada mensagem de grupo com as `MirrorRule` ativas (cache recarregado por evento Redis) e enfileira jobs `mirror-message`; o processor extrai links (`core`), converte (adapters), deduplica (`MirrorLog`), renderiza (Clone/Template) e envia respeitando janela e rate limit. A API expõe CRUD de regras, logs e stats; a web ganha a tela `/espelhamento` e as conexões ML/Amazon/Magalu por tag.

**Tech Stack:** o mesmo da F1 (TypeScript, Fastify, Prisma, BullMQ, Baileys, Next.js 15, Vitest, Playwright).

## Global Constraints

- Regras do `forTenant`: nunca `findUnique/update/delete` em modelos com `tenantId` via `req.db` — usar `findFirst`/`updateMany`/`deleteMany`. `MirrorRule` e `MirrorLog` entram em `TENANT_MODELS`.
- Erros da API: `{ error: { code, message } }`; sem códigos novos (`VALIDATION`, `NOT_FOUND`, `MARKETPLACE_ERROR`).
- Fila nova `mirror-message` (`QUEUE_MIRROR_MESSAGE`), `jobId = ${ruleId}:${msgId}`, `attempts: 3`, backoff exponencial 30s. Fora da janela → `moveToDelayed` + `DelayedError` (padrão do `send-offer`).
- `MirrorLog.reason` usa strings estáveis: `no-links`, `duplicate`, `template->clone`, `unsupported-store:<KIND[,KIND]>`; erros usam a mensagem do erro.
- `buildAffiliateUrl` remove parâmetros de rastreio alheios: `utm_*`, `ref`, `sp_atk`, `xptdk`, `forceInApp`. Valores de afiliado em testes são fictícios (`minha-20`, `minhaid`, `12345678`, `minhaloja`).
- Web: tokens/componentes existentes (`bg-brand`, `text-muted-foreground`, `StatusPill`, `useApiMutation`, `apiFetch`, `NativeCheckbox`); selects nativos onde houver teste em jsdom.
- Testes de integração usam Postgres `localhost:5434` + Redis via `.env` (`set -a && . ./.env && set +a`). Cada arquivo de teste cria e apaga seu tenant.
- Prettier antes de commitar (`pnpm format`); commits em português; trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Após alterar `schema.prisma`: `pnpm --filter @afilados/db exec prisma migrate dev --name <nome>` e `pnpm db:generate`; commitar a pasta da migration.

## File Structure

```
packages/shared/src/
  enums.ts           + MIRROR_MODES, MIRROR_LOG_STATUSES
  events.ts          + mirror.log, mirror.rules.changed
  queues.ts          + QUEUE_MIRROR_MESSAGE, MirrorMessageJob
  api.ts             + mirrorRuleSchema, mirrorLogsQuerySchema; marketplaceUpdateSchema ganha mattWord/mattTool
  marketplaces.ts    TagCredentials, requiredTagFields, hasTagCredentials
packages/db/prisma/schema.prisma      MirrorRule (campos novos), MirrorLog, enum MirrorLogStatus, relações
packages/db/src/index.ts              TENANT_MODELS + 'MirrorLog'
packages/core/src/links.ts            extractStoreLinks, buildAffiliateUrl, rewriteLinks, productKey
packages/core/src/wa-message.ts       pickText, hasImage
packages/marketplaces/src/tag-adapter.ts   createTagAdapter(kind), UnsupportedError
packages/marketplaces/src/registry.ts      getAdapter(kind)
apps/api/src/lib/marketplaces.ts      publicConnection com mattWord/mattTool; loadTagCredentials
apps/api/src/routes/marketplaces.ts   PUT/check para AMAZON/MAGALU/MERCADOLIVRE
apps/api/src/routes/mirror.ts         CRUD regras, toggle, logs, stats
apps/api/test/mirror.test.ts; apps/api/test/marketplaces.test.ts (+casos)
apps/worker/src/wa/gateway.ts         OutgoingImage.imageBuffer?, IncomingMessage, onMessage/downloadMedia no gateway
apps/worker/src/wa/baileys-gateway.ts messages.upsert → handlers; imageBuffer no sendMessage; downloadMedia
apps/worker/src/mirror/listener.ts    MirrorListener
apps/worker/src/processors/mirror-message.ts
apps/worker/src/main.ts               wiring
apps/worker/test/mirror-listener.test.ts; apps/worker/test/mirror-message.test.ts
apps/web/src/lib/types.ts             MirrorRule, MirrorLog, MirrorStats
apps/web/src/lib/queries.ts           useMirrorRules, useMirrorLogs, useMirrorStats
apps/web/src/components/mirror/{rule-form,rule-list,log-table}.tsx
apps/web/src/components/settings/tag-connection-form.tsx
apps/web/src/app/(app)/espelhamento/page.tsx
apps/web/src/app/(app)/config/{mercadolivre,amazon,magalu}/page.tsx
apps/web/test/rule-form.test.tsx; apps/web/e2e/espelhamento.spec.ts
```

---

### Task 1: `shared` — eventos, fila, schemas e credenciais por tag

**Files:**
- Modify: `packages/shared/src/enums.ts`, `packages/shared/src/events.ts`, `packages/shared/src/queues.ts`, `packages/shared/src/api.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/marketplaces.ts`
- Test: `packages/shared/test/mirror-schemas.test.ts`

**Interfaces:**
- Produces:
  - `MIRROR_MODES = ['TEMPLATE','CLONE']`, `MirrorMode`; `MIRROR_LOG_STATUSES = ['MIRRORED','DISCARDED','ERROR']`, `MirrorLogStatus`.
  - `RealtimeEvent` += `{ type: 'mirror.log'; ruleId; logId; status: MirrorLogStatus; reason?: string; targetJid }` e `{ type: 'mirror.rules.changed' }`.
  - `QUEUE_MIRROR_MESSAGE = 'mirror-message'`; `MirrorMessageJob = { tenantId; ruleId; sessionId; sourceJid; msgId; message: unknown }`.
  - `TagCredentials = { tag?; mattWord?; mattTool? }`; `requiredTagFields(kind)`; `hasTagCredentials(kind, creds)`.
  - `mirrorRuleSchema` / `MirrorRuleBody`; `mirrorLogsQuerySchema`; `marketplaceUpdateSchema` += `mattWord`, `mattTool`.

- [ ] **Step 1: Teste — `packages/shared/test/mirror-schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mirrorRuleSchema, mirrorLogsQuerySchema, marketplaceUpdateSchema } from '../src/api';
import { hasTagCredentials, requiredTagFields } from '../src/marketplaces';

describe('mirrorRuleSchema', () => {
  const base = { name: 'R', sessionId: 's', sourceJids: ['a@g.us'], targetJids: ['b@g.us'] };
  it('defaults', () => {
    expect(mirrorRuleSchema.parse(base)).toEqual({
      ...base, mode: 'CLONE', mediaMode: 'PREVIEW', dedupHours: 12, enabled: true,
    });
  });
  it('rejeita origem = destino', () => {
    expect(() => mirrorRuleSchema.parse({ ...base, targetJids: ['a@g.us'] })).toThrow(/destino/);
  });
  it('rejeita listas vazias e dedup fora do limite', () => {
    expect(() => mirrorRuleSchema.parse({ ...base, sourceJids: [] })).toThrow();
    expect(() => mirrorRuleSchema.parse({ ...base, dedupHours: 0 })).toThrow();
    expect(() => mirrorRuleSchema.parse({ ...base, dedupHours: 169 })).toThrow();
  });
});

describe('mirrorLogsQuerySchema', () => {
  it('defaults e limite', () => {
    expect(mirrorLogsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(() => mirrorLogsQuerySchema.parse({ limit: 201 })).toThrow();
    expect(mirrorLogsQuerySchema.parse({ status: 'ERROR', limit: '10' })).toEqual({ status: 'ERROR', limit: 10 });
  });
});

describe('tag credentials', () => {
  it('campos obrigatórios por loja', () => {
    expect(requiredTagFields('AMAZON')).toEqual(['tag']);
    expect(requiredTagFields('MERCADOLIVRE')).toEqual(['mattWord', 'mattTool']);
    expect(hasTagCredentials('MERCADOLIVRE', { mattWord: 'x' })).toBe(false);
    expect(hasTagCredentials('MERCADOLIVRE', { mattWord: 'x', mattTool: '1' })).toBe(true);
    expect(hasTagCredentials('MAGALU', { tag: 'loja' })).toBe(true);
  });
  it('marketplaceUpdateSchema aceita mattWord/mattTool', () => {
    expect(marketplaceUpdateSchema.parse({ mattWord: 'minhaid', mattTool: '12345678' })).toEqual({
      mattWord: 'minhaid', mattTool: '12345678',
    });
    expect(() => marketplaceUpdateSchema.parse({ mattTool: 'abc' })).toThrow();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar** — `pnpm --filter @afilados/shared test` → FAIL.

- [ ] **Step 3: Implementar**

`enums.ts` — acrescentar:
```ts
export const MIRROR_MODES = ['TEMPLATE', 'CLONE'] as const;
export type MirrorMode = (typeof MIRROR_MODES)[number];
export const MIRROR_LOG_STATUSES = ['MIRRORED', 'DISCARDED', 'ERROR'] as const;
export type MirrorLogStatus = (typeof MIRROR_LOG_STATUSES)[number];
```

`marketplaces.ts` (novo):
```ts
import type { MarketplaceKind } from './enums';

/** Credenciais das lojas convertidas por parâmetros na URL (sem API). */
export interface TagCredentials {
  tag?: string; // Amazon: "SEUID-20"; Magalu: nome da loja em magazinevoce.com.br/<loja>
  mattWord?: string; // Mercado Livre: ID do afiliado
  mattTool?: string; // Mercado Livre: número fixo da conta
}

export function requiredTagFields(kind: MarketplaceKind): (keyof TagCredentials)[] {
  switch (kind) {
    case 'AMAZON':
    case 'MAGALU':
      return ['tag'];
    case 'MERCADOLIVRE':
      return ['mattWord', 'mattTool'];
    default:
      return [];
  }
}

export function hasTagCredentials(kind: MarketplaceKind, creds: TagCredentials | null | undefined): boolean {
  if (!creds) return false;
  return requiredTagFields(kind).every((f) => typeof creds[f] === 'string' && creds[f]!.length > 0);
}
```

`events.ts` — importar `MirrorLogStatus` e adicionar à união:
```ts
  | { type: 'mirror.log'; ruleId: string; logId: string; status: MirrorLogStatus; reason?: string; targetJid: string }
  | { type: 'mirror.rules.changed' }
```

`queues.ts` — acrescentar:
```ts
export const QUEUE_MIRROR_MESSAGE = 'mirror-message';

export interface MirrorMessageJob {
  tenantId: string;
  ruleId: string;
  sessionId: string;
  sourceJid: string;
  msgId: string;
  /** WAMessage serializado com BufferJSON.replacer */
  message: unknown;
}
```

`api.ts` — substituir `marketplaceUpdateSchema` e acrescentar os novos (importar `MIRROR_LOG_STATUSES`, `MIRROR_MODES` de `./enums`):
```ts
export const marketplaceUpdateSchema = z.object({
  appId: z.string().min(1).optional(),
  secret: z.string().min(1).optional(),
  affiliateTag: z.string().max(100).optional(),
  mattWord: z.string().min(1).max(60).optional(),
  mattTool: z.string().regex(/^\d{1,12}$/, 'matt_tool deve ser numérico').optional(),
});

export const mirrorRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sessionId: z.string().min(1),
    sourceJids: z.array(z.string().min(1)).min(1),
    targetJids: z.array(z.string().min(1)).min(1),
    mode: z.enum(MIRROR_MODES).default('CLONE'),
    mediaMode: z.enum(MEDIA_MODES).default('PREVIEW'),
    templateId: z.string().min(1).optional(),
    dedupHours: z.number().int().min(1).max(168).default(12),
    enabled: z.boolean().default(true),
  })
  .refine((r) => !r.sourceJids.some((j) => r.targetJids.includes(j)), {
    message: 'um grupo não pode ser origem e destino ao mesmo tempo',
    path: ['targetJids'],
  });
export type MirrorRuleBody = z.infer<typeof mirrorRuleSchema>;

export const mirrorLogsQuerySchema = z.object({
  ruleId: z.string().min(1).optional(),
  status: z.enum(MIRROR_LOG_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
```

`index.ts`: `export * from './marketplaces';`

- [ ] **Step 4: Rodar e commitar**

Run: `pnpm --filter @afilados/shared test && pnpm --filter @afilados/shared typecheck` → PASS.

```bash
pnpm format && git add packages/shared && git commit -m "feat(shared): eventos, fila e schemas do espelhamento; credenciais por tag

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `db` — migration `MirrorRule` + `MirrorLog`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- Create: `packages/db/prisma/migrations/<ts>_mirror/`
- Test: `packages/db/test/mirror.test.ts`

**Interfaces (Prisma):**
```prisma
model MirrorRule {
  id          String     @id @default(cuid())
  tenantId    String
  tenant      Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessionId   String
  session     WaSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  name        String     @default("Espelhamento")
  sourceJids  String[]
  targetJids  String[]
  mode        MirrorMode @default(CLONE)
  mediaMode   MediaMode  @default(PREVIEW)
  templateId  String?
  template    Template?  @relation(fields: [templateId], references: [id], onDelete: SetNull)
  dedupHours  Int        @default(12)
  enabled     Boolean    @default(true)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @default(now()) @updatedAt
  logs        MirrorLog[]
  @@index([tenantId, enabled])
}

enum MirrorLogStatus { MIRRORED DISCARDED ERROR }

model MirrorLog {
  id          String          @id @default(cuid())
  tenantId    String
  tenant      Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ruleId      String
  rule        MirrorRule      @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  sourceJid   String
  sourceMsgId String
  targetJid   String
  status      MirrorLogStatus
  reason      String?
  productKey  String?
  waMessageId String?
  createdAt   DateTime        @default(now())
  @@index([tenantId, targetJid, productKey, createdAt])
  @@index([ruleId, createdAt])
  @@index([tenantId, createdAt])
}
```
Relações inversas: `WaSession.mirrorRules MirrorRule[]`, `Template.mirrorRules MirrorRule[]`, `Tenant.mirrorLogs MirrorLog[]`. `TENANT_MODELS` += `'MirrorLog'`.

- [ ] **Step 1: Editar `schema.prisma`** (substituir o `model MirrorRule` atual; adicionar enum, `MirrorLog` e as três relações inversas).

- [ ] **Step 2: Migration e generate**

Run: `pnpm --filter @afilados/db exec prisma migrate dev --name mirror && pnpm db:generate`
Expected: pasta `<ts>_mirror/` criada. `MirrorRule` está vazia em dev — se o Prisma pedir confirmação por coluna obrigatória (`sessionId`) sem default, confirmar.

- [ ] **Step 3: Teste — `packages/db/test/mirror.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant } from '../src/index';

let a: string;
let b: string;
let sessionA: string;

beforeAll(async () => {
  a = (await prisma.tenant.create({ data: { name: 'mirror-a' } })).id;
  b = (await prisma.tenant.create({ data: { name: 'mirror-b' } })).id;
  sessionA = (await prisma.waSession.create({ data: { tenantId: a, label: 's' } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.$disconnect();
});

describe('MirrorRule/MirrorLog', () => {
  it('cria regra com defaults e log em cascata escopados por tenant', async () => {
    const rule = await prisma.mirrorRule.create({
      data: { tenantId: a, sessionId: sessionA, sourceJids: ['s@g.us'], targetJids: ['t@g.us'] },
    });
    expect(rule).toMatchObject({ name: 'Espelhamento', mode: 'CLONE', mediaMode: 'PREVIEW', dedupHours: 12, enabled: true });
    await prisma.mirrorLog.create({
      data: { tenantId: a, ruleId: rule.id, sourceJid: 's@g.us', sourceMsgId: 'm1', targetJid: 't@g.us', status: 'MIRRORED', productKey: 'SHOPEE:1' },
    });
    expect(await forTenant(a).mirrorLog.count()).toBe(1);
    expect(await forTenant(b).mirrorLog.count()).toBe(0);
    await prisma.mirrorRule.delete({ where: { id: rule.id } });
    expect(await prisma.mirrorLog.count({ where: { ruleId: rule.id } })).toBe(0);
  });
});
```

- [ ] **Step 4: `TENANT_MODELS`** — adicionar `'MirrorLog',` após `'MirrorRule',` em `packages/db/src/index.ts`.

Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/db test && pnpm --filter @afilados/db typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && git add packages/db && git commit -m "feat(db): MirrorRule completa e MirrorLog com índices de dedup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `core` — links de loja, URL de afiliado, rewrite, productKey, pickText

**Files:**
- Create: `packages/core/src/links.ts`, `packages/core/src/wa-message.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/links.test.ts`, `packages/core/test/wa-message.test.ts`

**Interfaces:**
```ts
export interface StoreLink { url: string; parsed: Extract<ParsedProductUrl, { source: MarketplaceKind }> }
export function extractStoreLinks(text: string): StoreLink[];
export function buildAffiliateUrl(kind: MarketplaceKind, url: string, creds: TagCredentials): string; // lança em SHOPEE ou creds incompletas
export function rewriteLinks(text: string, replacements: Map<string, string>): string;
export function productKey(parsed: { source: string; externalId: string }): string;
export function pickText(message: unknown): string;   // aceita WAMessage ({message:{...}}) ou o objeto message direto
export function hasImage(message: unknown): boolean;
```

- [ ] **Step 1: Testes**

`packages/core/test/links.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildAffiliateUrl, extractStoreLinks, productKey, rewriteLinks } from '../src/links';

describe('extractStoreLinks', () => {
  it('pega só links oficiais, sem duplicar, na ordem', () => {
    const text = `Oferta! https://shopee.com.br/Prod-i.123.456?sp_atk=x
veja https://www.amazon.com.br/dp/B0ABCDEF12/ref=x e https://meli.la/abc e https://exemplo.com
de novo https://shopee.com.br/Prod-i.123.456?sp_atk=x`;
    const links = extractStoreLinks(text);
    expect(links.map((l) => l.parsed.source)).toEqual(['SHOPEE', 'AMAZON']);
    expect(links[0]!.parsed).toMatchObject({ externalId: '456', shopId: '123' });
  });
  it('ignora pontuação final grudada', () => {
    expect(extractStoreLinks('link: https://www.amazon.com.br/dp/B0ABCDEF12).')[0]!.url).toBe('https://www.amazon.com.br/dp/B0ABCDEF12');
  });
  it('vazio sem links', () => {
    expect(extractStoreLinks('sem nada aqui')).toEqual([]);
    expect(extractStoreLinks('')).toEqual([]);
  });
});

describe('buildAffiliateUrl', () => {
  it('amazon: seta tag, remove ref e utm', () => {
    expect(buildAffiliateUrl('AMAZON', 'https://www.amazon.com.br/Nome/dp/B0ABCDEF12/ref=sr_1?tag=outro-20&utm_source=x', { tag: 'minha-20' }))
      .toBe('https://www.amazon.com.br/Nome/dp/B0ABCDEF12/?tag=minha-20');
  });
  it('mercado livre: matt_word + matt_tool, limpa forceInApp e hash', () => {
    expect(buildAffiliateUrl('MERCADOLIVRE', 'https://produto.mercadolivre.com.br/MLB-123-x-_JM?forceInApp=true#polycard', { mattWord: 'minhaid', mattTool: '12345678' }))
      .toBe('https://produto.mercadolivre.com.br/MLB-123-x-_JM?matt_word=minhaid&matt_tool=12345678');
  });
  it('mercado livre exige os dois', () => {
    expect(() => buildAffiliateUrl('MERCADOLIVRE', 'https://produto.mercadolivre.com.br/MLB-1', { mattWord: 'x' })).toThrow(/matt_tool/);
  });
  it('magalu: magazinevoce com a loja', () => {
    expect(buildAffiliateUrl('MAGALU', 'https://www.magazineluiza.com.br/nome/p/abc123/te/ab12/?utm_x=1', { tag: 'minhaloja' }))
      .toBe('https://www.magazinevoce.com.br/minhaloja/nome/p/abc123/te/ab12/');
  });
  it('shopee lança', () => {
    expect(() => buildAffiliateUrl('SHOPEE', 'https://shopee.com.br/x-i.1.2', { tag: 'x' })).toThrow();
  });
});

describe('rewriteLinks', () => {
  it('substitui todas as ocorrências preservando o texto', () => {
    const map = new Map([['https://a.com/x', 'https://b.com/y']]);
    expect(rewriteLinks('veja https://a.com/x agora https://a.com/x!', map)).toBe('veja https://b.com/y agora https://b.com/y!');
  });
});

describe('productKey', () => {
  it('formata', () => expect(productKey({ source: 'AMAZON', externalId: 'B0X' })).toBe('AMAZON:B0X'));
});
```

`packages/core/test/wa-message.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hasImage, pickText } from '../src/wa-message';

describe('pickText', () => {
  it('conversation', () => expect(pickText({ message: { conversation: 'oi' } })).toBe('oi'));
  it('extendedText', () => expect(pickText({ message: { extendedTextMessage: { text: 'ext' } } })).toBe('ext'));
  it('caption', () => expect(pickText({ message: { imageMessage: { caption: 'cap' } } })).toBe('cap'));
  it('aceita o objeto message direto e vazio', () => {
    expect(pickText({ conversation: 'x' })).toBe('x');
    expect(pickText(null)).toBe('');
    expect(pickText({ message: {} })).toBe('');
  });
});
describe('hasImage', () => {
  it('detecta imageMessage', () => {
    expect(hasImage({ message: { imageMessage: { caption: 'c' } } })).toBe(true);
    expect(hasImage({ message: { conversation: 'x' } })).toBe(false);
    expect(hasImage(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar** — `pnpm --filter @afilados/core test` → FAIL.

- [ ] **Step 3: Implementar**

`packages/core/src/links.ts`:
```ts
import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import { parseProductUrl, type ParsedProductUrl } from './urls';

export interface StoreLink {
  url: string;
  parsed: Extract<ParsedProductUrl, { source: MarketplaceKind }>;
}

const URL_RE = /https?:\/\/[^\s<>()"'`]+/gi;
const TRAILING = /[.,;:!?)\]]+$/;

export function extractStoreLinks(text: string): StoreLink[] {
  const seen = new Set<string>();
  const out: StoreLink[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(TRAILING, '');
    if (seen.has(url)) continue;
    const parsed = parseProductUrl(url);
    if (parsed.source === 'UNSUPPORTED') continue;
    seen.add(url);
    out.push({ url, parsed });
  }
  return out;
}

const TRACKING_PARAMS = new Set(['ref', 'sp_atk', 'xptdk', 'forceInApp']);
function stripTracking(u: URL) {
  for (const k of [...u.searchParams.keys()]) {
    if (k.startsWith('utm_') || TRACKING_PARAMS.has(k)) u.searchParams.delete(k);
  }
  u.hash = '';
}

export function buildAffiliateUrl(kind: MarketplaceKind, url: string, creds: TagCredentials): string {
  const u = new URL(url);
  stripTracking(u);
  switch (kind) {
    case 'AMAZON': {
      if (!creds.tag) throw new Error('Amazon: tag de afiliado ausente');
      u.pathname = u.pathname.replace(/\/ref=[^/]*$/, '/'); // Amazon usa /ref=... como segmento
      u.searchParams.set('tag', creds.tag);
      return u.toString();
    }
    case 'MERCADOLIVRE': {
      if (!creds.mattWord) throw new Error('Mercado Livre: matt_word ausente');
      if (!creds.mattTool) throw new Error('Mercado Livre: matt_tool ausente');
      u.searchParams.delete('matt_word');
      u.searchParams.delete('matt_tool');
      u.searchParams.set('matt_word', creds.mattWord);
      u.searchParams.set('matt_tool', creds.mattTool);
      return u.toString();
    }
    case 'MAGALU': {
      if (!creds.tag) throw new Error('Magalu: nome da loja ausente');
      const path = u.pathname.replace(/^\/+/, '');
      return new URL(`https://www.magazinevoce.com.br/${creds.tag}/${path}`).toString();
    }
    case 'SHOPEE':
      throw new Error('Shopee usa a API (generateShortLink)');
  }
}

export function rewriteLinks(text: string, replacements: Map<string, string>): string {
  let out = text;
  for (const [from, to] of replacements) out = out.split(from).join(to);
  return out;
}

export function productKey(parsed: { source: string; externalId: string }): string {
  return `${parsed.source}:${parsed.externalId}`;
}
```

`packages/core/src/wa-message.ts`:
```ts
interface TextParts {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: { caption?: string | null } | null;
}

function unwrap(m: unknown): TextParts | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as { message?: unknown } & TextParts;
  if ('message' in o) return (o.message as TextParts | null | undefined) ?? null;
  return o;
}

/** Texto útil de uma WAMessage: conversation → extendedTextMessage.text → imageMessage.caption. */
export function pickText(message: unknown): string {
  const m = unwrap(message);
  return (m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? '').trim();
}

export function hasImage(message: unknown): boolean {
  const m = unwrap(message);
  return Boolean(m?.imageMessage);
}
```

`packages/core/src/index.ts`: `export * from './links'; export * from './wa-message';`

- [ ] **Step 4: Rodar e commitar**

Run: `pnpm --filter @afilados/core test && pnpm --filter @afilados/core typecheck` → PASS.

```bash
pnpm format && git add packages/core && git commit -m "feat(core): extração de links de loja, URL de afiliado por parâmetros, rewrite e texto da mensagem

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `marketplaces` — adapters por tag e registry

**Files:**
- Create: `packages/marketplaces/src/tag-adapter.ts`, `packages/marketplaces/src/registry.ts`
- Modify: `packages/marketplaces/src/index.ts`
- Test: `packages/marketplaces/test/tag-adapter.test.ts`

**Interfaces:**
```ts
export class UnsupportedError extends Error {}
export type TagKind = 'AMAZON' | 'MERCADOLIVRE' | 'MAGALU';
export function createTagAdapter(kind: TagKind): MarketplaceAdapter<TagCredentials>;
export type AnyAdapter = MarketplaceAdapter<ShopeeCredentials> | MarketplaceAdapter<TagCredentials>;
export function getAdapter(kind: MarketplaceKind, opts?: { shopee?: MarketplaceAdapter<ShopeeCredentials> }): AnyAdapter;
```

- [ ] **Step 1: Teste — `packages/marketplaces/test/tag-adapter.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createTagAdapter, UnsupportedError, getAdapter } from '../src/index';

describe('tag adapters', () => {
  it('amazon converte e valida conexão', async () => {
    const a = createTagAdapter('AMAZON');
    expect(await a.checkConnection({ tag: 'minha-20' })).toEqual({ ok: true });
    expect((await a.checkConnection({})).ok).toBe(false);
    expect(await a.toAffiliateLink({ tag: 'minha-20' }, 'https://www.amazon.com.br/dp/B0ABCDEF12'))
      .toBe('https://www.amazon.com.br/dp/B0ABCDEF12?tag=minha-20');
  });
  it('mercado livre exige matt_word e matt_tool', async () => {
    const a = createTagAdapter('MERCADOLIVRE');
    expect((await a.checkConnection({ mattWord: 'x' })).ok).toBe(false);
    expect((await a.checkConnection({ mattWord: 'x', mattTool: '1' })).ok).toBe(true);
  });
  it('search/fetchByUrls não suportados', async () => {
    const a = createTagAdapter('MAGALU');
    await expect(a.fetchByUrls({ tag: 'loja' }, ['https://www.magazineluiza.com.br/x/p/a1/te/ab/'])).rejects.toBeInstanceOf(UnsupportedError);
    expect(a.search).toBeUndefined();
  });
  it('registry devolve o adapter certo e cacheia', () => {
    expect(getAdapter('AMAZON').kind).toBe('AMAZON');
    expect(getAdapter('AMAZON')).toBe(getAdapter('AMAZON'));
    expect(getAdapter('SHOPEE').kind).toBe('SHOPEE');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar** — `pnpm --filter @afilados/marketplaces test` → FAIL.

- [ ] **Step 3: Implementar**

`src/tag-adapter.ts`:
```ts
import { buildAffiliateUrl } from '@afilados/core';
import { hasTagCredentials, requiredTagFields, type TagCredentials } from '@afilados/shared';
import type { ConnectionStatus, MarketplaceAdapter } from './adapter';

export class UnsupportedError extends Error {
  constructor(message = 'disponível na fase 3') {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export type TagKind = 'AMAZON' | 'MERCADOLIVRE' | 'MAGALU';

export function createTagAdapter(kind: TagKind): MarketplaceAdapter<TagCredentials> {
  return {
    kind,
    async checkConnection(creds): Promise<ConnectionStatus> {
      if (hasTagCredentials(kind, creds)) return { ok: true };
      return { ok: false, error: `Informe: ${requiredTagFields(kind).join(', ')}` };
    },
    async fetchByUrls() {
      throw new UnsupportedError();
    },
    async toAffiliateLink(creds, url) {
      return buildAffiliateUrl(kind, url, creds);
    },
  };
}
```

`src/registry.ts`:
```ts
import type { MarketplaceKind, TagCredentials } from '@afilados/shared';
import type { MarketplaceAdapter, ShopeeCredentials } from './adapter';
import { createShopeeAdapter } from './shopee/adapter';
import { createTagAdapter, type TagKind } from './tag-adapter';

export type AnyAdapter = MarketplaceAdapter<ShopeeCredentials> | MarketplaceAdapter<TagCredentials>;

const cache = new Map<MarketplaceKind, AnyAdapter>();

export function getAdapter(
  kind: MarketplaceKind,
  opts: { shopee?: MarketplaceAdapter<ShopeeCredentials> } = {},
): AnyAdapter {
  if (kind === 'SHOPEE' && opts.shopee) return opts.shopee;
  let a = cache.get(kind);
  if (!a) {
    a = kind === 'SHOPEE' ? createShopeeAdapter() : createTagAdapter(kind as TagKind);
    cache.set(kind, a);
  }
  return a;
}
```

`src/index.ts`: `export * from './tag-adapter'; export * from './registry';`

- [ ] **Step 4: Rodar e commitar**

Run: `pnpm --filter @afilados/marketplaces test && pnpm --filter @afilados/marketplaces typecheck` → PASS.

```bash
pnpm format && git add packages/marketplaces && git commit -m "feat(marketplaces): adapters por tag (Amazon, Mercado Livre, Magalu) e registry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `apps/api` — conexões ML/Amazon/Magalu por tag

**Files:**
- Modify: `apps/api/src/lib/marketplaces.ts`, `apps/api/src/routes/marketplaces.ts`
- Test: `apps/api/test/marketplaces.test.ts` (casos novos)

**Interfaces:**
- Consumes: `requiredTagFields`, `hasTagCredentials`, `TagCredentials` (`@afilados/shared`); `getAdapter` (`@afilados/marketplaces`).
- Produces: `publicConnection` devolve também `mattWord`/`mattTool` quando presentes; `PUT /marketplaces/:kind` e `POST /marketplaces/:kind/check` funcionam para `AMAZON|MAGALU|MERCADOLIVRE`.

- [ ] **Step 1: Teste — acrescentar a `apps/api/test/marketplaces.test.ts`**

```ts
describe('conexões por tag (Amazon/ML/Magalu)', () => {
  it('amazon: salva tag e testa conexão', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/v1/marketplaces/AMAZON', headers: { cookie }, payload: { affiliateTag: 'minha-20' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ kind: 'AMAZON', affiliateTag: 'minha-20' });
    const check = await app.inject({ method: 'POST', url: '/api/v1/marketplaces/AMAZON/check', headers: { cookie } });
    expect(check.json()).toMatchObject({ status: 'OK' });
  });
  it('mercado livre: exige matt_word e matt_tool juntos', async () => {
    const put1 = await app.inject({ method: 'PUT', url: '/api/v1/marketplaces/MERCADOLIVRE', headers: { cookie }, payload: { mattWord: 'minhaid' } });
    expect(put1.json()).toMatchObject({ status: 'UNCONFIGURED' });
    const put2 = await app.inject({ method: 'PUT', url: '/api/v1/marketplaces/MERCADOLIVRE', headers: { cookie }, payload: { mattTool: '12345678' } });
    expect(put2.json()).toMatchObject({ mattWord: 'minhaid', mattTool: '12345678', status: 'UNCONFIGURED' });
    const check = await app.inject({ method: 'POST', url: '/api/v1/marketplaces/MERCADOLIVRE/check', headers: { cookie } });
    expect(check.json()).toMatchObject({ status: 'OK' });
  });
  it('magalu sem tag → check falha com UNCONFIGURED continua', async () => {
    const check = await app.inject({ method: 'POST', url: '/api/v1/marketplaces/MAGALU/check', headers: { cookie } });
    expect(check.json()).toMatchObject({ status: 'ERROR' });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/api exec vitest run marketplaces`
Expected: FAIL — 400 "disponível na fase 3" nas rotas de ML/Amazon/Magalu.

- [ ] **Step 3: Implementar `apps/api/src/lib/marketplaces.ts`**

Substituir o corpo por:
```ts
import { decryptJson, type MarketplaceConnection, type TenantClient } from '@afilados/db';
import { createShopeeAdapter, getAdapter, type MarketplaceAdapter, type ShopeeCredentials } from '@afilados/marketplaces';
import { ApiError, requiredTagFields, type TagCredentials } from '@afilados/shared';

let shopee: MarketplaceAdapter<ShopeeCredentials> | null = null;
export function getShopeeAdapter() {
  if (!shopee) shopee = createShopeeAdapter();
  return shopee;
}

type AnyCreds = { appId?: string; secret?: string } & TagCredentials;

export function publicConnection(row: MarketplaceConnection | null, kind: MarketplaceConnection['kind']) {
  const creds = row?.encryptedCredentials ? decryptJson<AnyCreds>(Buffer.from(row.encryptedCredentials)) : null;
  return {
    kind,
    status: row?.status ?? 'UNCONFIGURED',
    affiliateTag: row?.affiliateTag ?? null,
    appId: creds?.appId ?? null,
    hasSecret: Boolean(creds?.secret),
    mattWord: creds?.mattWord ?? null,
    mattTool: creds?.mattTool ?? null,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function loadShopeeCredentials(db: TenantClient) {
  const row = await db.marketplaceConnection.findFirst({ where: { kind: 'SHOPEE' } });
  if (!row?.encryptedCredentials) {
    throw new ApiError('SHOPEE_UNCONFIGURED', 'Configure a API da Shopee em Configurações', 400);
  }
  const creds = decryptJson<ShopeeCredentials>(Buffer.from(row.encryptedCredentials));
  return { creds, affiliateTag: row.affiliateTag };
}

/** Credenciais por tag (Amazon/ML/Magalu) já validadas; lança SHOPEE_UNCONFIGURED-like para as demais. */
export async function loadTagCredentials(db: TenantClient, kind: 'AMAZON' | 'MAGALU' | 'MERCADOLIVRE') {
  const row = await db.marketplaceConnection.findFirst({ where: { kind } });
  const creds = row?.encryptedCredentials ? decryptJson<TagCredentials>(Buffer.from(row.encryptedCredentials)) : {};
  const missing = requiredTagFields(kind).filter((f) => !creds[f]);
  if (missing.length) {
    throw new ApiError('MARKETPLACE_ERROR', `${kind}: configure ${missing.join(', ')} em Configurações`, 400);
  }
  return creds;
}

export { getAdapter };
```

- [ ] **Step 4: Implementar `apps/api/src/routes/marketplaces.ts`**

Localizar o bloco `app.put('/marketplaces/:kind', ...)` e substituir por:

```ts
  app.put('/marketplaces/:kind', async (req) => {
    const { kind } = kindParams.parse(req.params);
    const body = marketplaceUpdateSchema.parse(req.body);
    const existing = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    const prev = existing?.encryptedCredentials
      ? decryptJson<{ appId?: string; secret?: string; tag?: string; mattWord?: string; mattTool?: string }>(Buffer.from(existing.encryptedCredentials))
      : {};
    const merged =
      kind === 'SHOPEE'
        ? { appId: body.appId ?? prev.appId, secret: body.secret ?? prev.secret }
        : kind === 'MERCADOLIVRE'
          ? { mattWord: body.mattWord ?? prev.mattWord, mattTool: body.mattTool ?? prev.mattTool }
          : { tag: body.affiliateTag ?? prev.tag };
    const hasAny = Object.values(merged).some((v) => v);
    const data = {
      encryptedCredentials: hasAny ? encryptJson(merged) : null,
      affiliateTag: kind === 'MERCADOLIVRE' ? (merged.mattWord ?? null) : (body.affiliateTag ?? existing?.affiliateTag ?? null),
      status: 'UNCONFIGURED' as const,
      lastError: null,
    };
    if (existing) await req.db.marketplaceConnection.updateMany({ where: { id: existing.id }, data });
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    else await req.db.marketplaceConnection.create({ data: { kind, ...data } });
    const row = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    return publicConnection(row, kind);
  });
```

Localizar `app.post('/marketplaces/:kind/check', ...)` e substituir por:

```ts
  app.post('/marketplaces/:kind/check', async (req) => {
    const { kind } = kindParams.parse(req.params);
    const row = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    if (!row?.encryptedCredentials) throw new ApiError('SHOPEE_UNCONFIGURED', 'Configure as credenciais', 400);
    const result =
      kind === 'SHOPEE'
        ? await getShopeeAdapter().checkConnection(decryptJson(Buffer.from(row.encryptedCredentials)))
        : await getAdapter(kind).checkConnection(decryptJson(Buffer.from(row.encryptedCredentials)));
    await req.db.marketplaceConnection.updateMany({
      where: { id: row.id },
      data: { status: result.ok ? 'OK' : 'ERROR', lastCheckedAt: new Date(), lastError: result.error ?? null },
    });
    return publicConnection(await req.db.marketplaceConnection.findFirst({ where: { kind } }), kind);
  });
```

Ajustar o import do topo do arquivo para incluir `getAdapter` (via `../lib/marketplaces`, já reexportado) e remover o `if (kind !== 'SHOPEE') throw ApiError.validation(...)` das duas rotas (não usar mais em nenhuma delas — `GET /marketplaces` continua igual).

- [ ] **Step 5: Rodar e commitar**

Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/api test && pnpm --filter @afilados/api typecheck`
Expected: PASS (marketplaces com os 3 casos novos).

```bash
pnpm format && git add apps/api && git commit -m "feat(api): conexões Amazon, Mercado Livre e Magalu por tag/matt_word+matt_tool

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `apps/worker` — gateway recebe mensagens e envia imagem via Buffer

**Files:**
- Modify: `apps/worker/src/wa/gateway.ts`, `apps/worker/src/wa/baileys-gateway.ts`
- Test: `apps/worker/test/baileys-lifecycle.test.ts` (caso novo, reaproveitando o mock de Baileys já existente)

**Interfaces:**
- Produces (`gateway.ts`):
```ts
export interface OutgoingImage {
  kind: 'image';
  imageUrl?: string;
  imageBuffer?: Buffer;
  caption: string;
}
// OutgoingPreview inalterado
export interface IncomingGroupMessage {
  sessionId: string;
  sourceJid: string;   // key.remoteJid
  msgId: string;       // key.id
  message: unknown;    // WAMessage completo (para BufferJSON e pickText/hasImage do core)
}
export interface WhatsAppGateway {
  isConnected(sessionId: string): boolean;
  sendMessage(sessionId: string, jid: string, msg: OutgoingMessage): Promise<{ messageId: string }>;
  fetchGroups(sessionId: string): Promise<GroupInfo[]>;
  onMessage(handler: (msg: IncomingGroupMessage) => void): void;
  downloadMedia(sessionId: string, message: unknown): Promise<Buffer>;
}
```
- `BaileysGateway` implementa `onMessage`/`downloadMedia`; `sendMessage` com `OutgoingImage.imageBuffer` usa `{ image: msg.imageBuffer, caption }` (Baileys aceita `Buffer` em `image`); mantém `imageUrl` para compatibilidade com `send-offer`.

- [ ] **Step 1: Teste — acrescentar a `apps/worker/test/baileys-lifecycle.test.ts`**

```ts
it('onMessage repassa mensagem de grupo não-própria; ignora fromMe e DM', async () => {
  const received: IncomingGroupMessage[] = [];
  gateway.onMessage((m) => received.push(m));
  await gateway.connect({ id: sessionId, tenantId }, { mode: 'qr' });
  const sock = lastFakeSocket();
  sock.ev.emit('messages.upsert', {
    type: 'notify',
    messages: [
      { key: { remoteJid: 'g1@g.us', fromMe: false, id: 'M1' }, message: { conversation: 'oi' } },
      { key: { remoteJid: 'g1@g.us', fromMe: true, id: 'M2' }, message: { conversation: 'eu' } },
      { key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'M3' }, message: { conversation: 'dm' } },
    ],
  });
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ sessionId, sourceJid: 'g1@g.us', msgId: 'M1' });
});
```

Consultar o topo do arquivo de teste existente para reaproveitar `lastFakeSocket()`/equivalente do mock de `makeWASocket` já usado nos outros casos (`connection.update`, pair code); usar o mesmo padrão de `sock.ev.emit` já presente nesse arquivo.

- [ ] **Step 2: Rodar para ver falhar**

Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/worker exec vitest run baileys-lifecycle`
Expected: FAIL — `gateway.onMessage is not a function`.

- [ ] **Step 3: Implementar `apps/worker/src/wa/gateway.ts`**

```ts
export interface OutgoingImage {
  kind: 'image';
  imageUrl?: string;
  imageBuffer?: Buffer;
  caption: string;
}
export interface OutgoingPreview {
  kind: 'preview';
  text: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  url: string;
}
export type OutgoingMessage = OutgoingImage | OutgoingPreview;
export interface GroupInfo {
  jid: string;
  name: string;
  kind: 'GROUP' | 'COMMUNITY' | 'CHANNEL';
  botIsAdmin: boolean;
  memberCount: number;
  inviteLink?: string;
}
export interface IncomingGroupMessage {
  sessionId: string;
  sourceJid: string;
  msgId: string;
  message: unknown;
}
export interface WhatsAppGateway {
  isConnected(sessionId: string): boolean;
  sendMessage(sessionId: string, jid: string, msg: OutgoingMessage): Promise<{ messageId: string }>;
  fetchGroups(sessionId: string): Promise<GroupInfo[]>;
  onMessage(handler: (msg: IncomingGroupMessage) => void): void;
  downloadMedia(sessionId: string, message: unknown): Promise<Buffer>;
}
```

- [ ] **Step 4: Implementar em `apps/worker/src/wa/baileys-gateway.ts`**

No topo, adicionar import: `import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';`

No `class BaileysGateway`, adicionar campo e método:
```ts
  private messageHandlers: ((m: IncomingGroupMessage) => void)[] = [];

  onMessage(handler: (m: IncomingGroupMessage) => void) {
    this.messageHandlers.push(handler);
  }

  async downloadMedia(sessionId: string, message: unknown): Promise<Buffer> {
    const l = this.live.get(sessionId);
    if (!l) throw new Error('WA_NOT_CONNECTED');
    const buf = await downloadMediaMessage(message as WAMessage, 'buffer', {});
    return buf as Buffer;
  }
```

No handler de conexão (`open`), depois de `sock.ev.on('creds.update', ...)`, registrar:
```ts
    sock.ev.on('messages.upsert', ({ type, messages }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid?.endsWith('@g.us') || msg.key.fromMe || !msg.key.id) continue;
        const incoming: IncomingGroupMessage = { sessionId, sourceJid: remoteJid, msgId: msg.key.id, message: msg };
        for (const h of this.messageHandlers) h(incoming);
      }
    });
```
(inserir dentro do mesmo bloco onde `creds.update`/`connection.update` já são registrados, usando o `sessionId` do escopo de `open`; adicionar essa listener à lista de `cleanup` do `Live` do mesmo jeito que as demais, se o padrão existente fizer isso — conferir e seguir o padrão local).

Em `sendMessage`, no ramo `image`, trocar:
```ts
        ? await l.sock.sendMessage(jid, { image: { url: msg.imageUrl }, caption: msg.caption })
```
por:
```ts
        ? await l.sock.sendMessage(jid, { image: msg.imageBuffer ?? { url: msg.imageUrl! }, caption: msg.caption })
```

- [ ] **Step 5: Rodar, typecheck, commitar**

Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/worker test && pnpm --filter @afilados/worker typecheck`
Expected: PASS.

```bash
pnpm format && git add apps/worker && git commit -m "feat(worker): gateway repassa mensagens de grupo e envia imagem por Buffer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `apps/worker` — `MirrorListener` (casa mensagem com regra e enfileira)

**Files:**
- Create: `apps/worker/src/mirror/listener.ts`
- Test: `apps/worker/test/mirror-listener.test.ts`

**Interfaces:**
- Consumes: `WhatsAppGateway.onMessage`, `getQueue` (`../lib/redis`), `QUEUE_MIRROR_MESSAGE`, `MirrorMessageJob` (`@afilados/shared`), `prisma` (`@afilados/db`).
- Produces:
```ts
export class MirrorListener {
  constructor(gateway: WhatsAppGateway, deps?: { queue?: { add(name: string, data: MirrorMessageJob, opts: object): Promise<unknown> } });
  start(): Promise<void>;          // carrega regras ativas do banco, popula o cache, registra gateway.onMessage
  reload(): Promise<void>;         // recarrega do banco (chamado ao receber mirror.rules.changed)
  ruleCount(): number;             // para health/testes
}
```
Cache interno: `Map<string /*sessionId*/, Map<string /*sourceJid*/, { id: string }[]>>` — só o necessário para decidir "enfileirar para estas regras"; dados completos da regra são recarregados pelo processor a cada job (evita ficar desatualizado).

- [ ] **Step 1: Teste — `apps/worker/test/mirror-listener.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@afilados/db';
import type { IncomingGroupMessage, WhatsAppGateway } from '../src/wa/gateway';
import { MirrorListener } from '../src/mirror/listener';

class FakeGateway implements Pick<WhatsAppGateway, 'onMessage'> {
  private handler: ((m: IncomingGroupMessage) => void) | null = null;
  onMessage(h: (m: IncomingGroupMessage) => void) { this.handler = h; }
  emit(m: IncomingGroupMessage) { this.handler?.(m); }
}

let tenantId: string;
let sessionId: string;
let ruleId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'listener' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id;
  const rule = await prisma.mirrorRule.create({
    data: { tenantId, sessionId, sourceJids: ['src@g.us'], targetJids: ['dst@g.us'], enabled: true },
  });
  ruleId = rule.id;
});
afterAll(async () => { await prisma.tenant.deleteMany({ where: { id: tenantId } }); await prisma.$disconnect(); });

describe('MirrorListener', () => {
  it('enfileira job só para mensagens de origem com regra ativa', async () => {
    const gateway = new FakeGateway();
    const added: unknown[] = [];
    const queue = { add: async (_n: string, data: unknown) => { added.push(data); } };
    const listener = new MirrorListener(gateway as unknown as WhatsAppGateway, { queue });
    await listener.start();
    expect(listener.ruleCount()).toBe(1);

    gateway.emit({ sessionId, sourceJid: 'src@g.us', msgId: 'M1', message: { conversation: 'x' } });
    gateway.emit({ sessionId, sourceJid: 'outro@g.us', msgId: 'M2', message: { conversation: 'y' } });
    await new Promise((r) => setTimeout(r, 10));

    expect(added).toEqual([{ tenantId, ruleId, sessionId, sourceJid: 'src@g.us', msgId: 'M1', message: { conversation: 'x' } }]);
  });

  it('regra desativada não é carregada; reload() atualiza o cache', async () => {
    await prisma.mirrorRule.updateMany({ where: { id: ruleId }, data: { enabled: false } });
    const gateway = new FakeGateway();
    const listener = new MirrorListener(gateway as unknown as WhatsAppGateway, { queue: { add: async () => {} } });
    await listener.start();
    expect(listener.ruleCount()).toBe(0);
    await prisma.mirrorRule.updateMany({ where: { id: ruleId }, data: { enabled: true } });
    await listener.reload();
    expect(listener.ruleCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/worker exec vitest run mirror-listener`
Expected: FAIL — módulo ausente.

- [ ] **Step 3: Implementar `apps/worker/src/mirror/listener.ts`**

```ts
import pino from 'pino';
import { prisma } from '@afilados/db';
import { QUEUE_MIRROR_MESSAGE, type MirrorMessageJob } from '@afilados/shared';
import { getQueue } from '../lib/redis';
import type { IncomingGroupMessage, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'mirror-listener' });

interface QueueLike {
  add(name: string, data: MirrorMessageJob, opts: { jobId: string; attempts: number; backoff: { type: string; delay: number } }): Promise<unknown>;
}

export class MirrorListener {
  private cache = new Map<string, Map<string, { id: string; tenantId: string }[]>>();
  private readonly queue: QueueLike;

  constructor(
    private readonly gateway: Pick<WhatsAppGateway, 'onMessage'>,
    deps: { queue?: QueueLike } = {},
  ) {
    this.queue = deps.queue ?? getQueue<MirrorMessageJob>(QUEUE_MIRROR_MESSAGE);
  }

  async start() {
    await this.reload();
    this.gateway.onMessage((m) => {
      void this.handle(m).catch((e) => log.error(e, 'falha ao processar mensagem recebida'));
    });
  }

  async reload() {
    const rules = await prisma.mirrorRule.findMany({
      where: { enabled: true },
      select: { id: true, tenantId: true, sessionId: true, sourceJids: true },
    });
    const next = new Map<string, Map<string, { id: string; tenantId: string }[]>>();
    for (const r of rules) {
      if (!next.has(r.sessionId)) next.set(r.sessionId, new Map());
      const bySession = next.get(r.sessionId)!;
      for (const jid of r.sourceJids) {
        if (!bySession.has(jid)) bySession.set(jid, []);
        bySession.get(jid)!.push({ id: r.id, tenantId: r.tenantId });
      }
    }
    this.cache = next;
  }

  ruleCount() {
    let n = 0;
    for (const bySession of this.cache.values()) for (const rules of bySession.values()) n += rules.length;
    return n;
  }

  private async handle(m: IncomingGroupMessage) {
    const rules = this.cache.get(m.sessionId)?.get(m.sourceJid);
    if (!rules?.length) return;
    for (const rule of rules) {
      const job: MirrorMessageJob = {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        sessionId: m.sessionId,
        sourceJid: m.sourceJid,
        msgId: m.msgId,
        message: m.message,
      };
      await this.queue.add('mirror-message', job, {
        jobId: `${rule.id}:${m.msgId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      });
    }
  }
}
```

- [ ] **Step 4: Rodar, typecheck, commitar**

Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/worker test && pnpm --filter @afilados/worker typecheck`
Expected: PASS.

```bash
pnpm format && git add apps/worker && git commit -m "feat(worker): MirrorListener casa mensagens de grupo com regras ativas

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
