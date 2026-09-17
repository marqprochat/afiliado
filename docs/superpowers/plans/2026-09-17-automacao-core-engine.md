# Automação — Motor Central (Plano 1/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o motor de automação funcional de ponta a ponta — regras (`AutomationRule`), fila visível por regra com inserção manual de link ou cupom, e o scheduler que dispara sozinho pelo pipeline de `Batch` já existente — usando Shopee (que já tem busca por API) como único marketplace com descoberta 100% automática nesta primeira fase.

**Architecture:** Reaproveita o pipeline de envio existente (`Batch`/`BatchItem`/`SendLog`, `sendOffer`, rate-limit, janela de operação) em vez de duplicá-lo. Um novo `AutomationScheduler` no worker (mesmo padrão do `MirrorListener`) decide *o quê* e *quando* despachar; a decisão nunca pula o portão de validação de produto/cupom completo. Mercado Livre/Amazon/Magalu continuam suportados **apenas via inserção manual de link** nesta fase (descoberta automática deles é o Plano 2); Awin é o Plano 3.

**Tech Stack:** Fastify + Zod (API), BullMQ + Prisma (worker), Next.js + TanStack Query (web), Vitest (testes de integração contra Postgres real, seguindo o padrão já usado em `apps/api/test` e `apps/worker/test`).

## Global Constraints

- Nenhum item entra em um `Batch` sem passar pelo portão de validação (produto completo / cupom válido) — spec §5.1.
- Falha de descoberta ou de sync nunca propaga para travar outras regras nem para reenviar item antigo como fallback — spec §5.1.
- Sem colunas de contador redundante (`sentToday` etc.) — estatísticas sempre derivadas de `AutomationLog` — spec §3.
- Item manual (`AutomationQueueItem.manual = true`) sempre despachado antes de qualquer item descoberto automaticamente — spec §3.1.
- `renderTemplate`/`Template.body` continuam com 1 corpo fixo (sem variantes sorteadas) — fora de escopo, spec §2.

---

## Referências do código existente (ler antes de começar)

- `packages/db/prisma/schema.prisma` — modelos atuais (`Tenant`, `Template`, `Batch`, `BatchItem`, `Coupon`, `MarketplaceConnection`).
- `apps/worker/src/mirror/listener.ts` — padrão de listener em memória + reload por evento pub/sub, a ser espelhado pelo `AutomationScheduler`.
- `apps/worker/src/processors/send-offer.ts` — pipeline de envio a ser estendido (branch de cupom).
- `apps/api/src/routes/batches.ts` — padrão de validação de rota (sessão conectada, grupos pertencem à sessão, template existe).
- `apps/api/src/lib/batches.ts` — `enqueueBatchItems`/`removePendingJobs` (só existe do lado da API; o worker precisa do próprio helper, ver Task 4).
- `apps/api/test/batches.test.ts` e `apps/api/test/helpers.ts` — padrão de teste de integração (Fastify `app.inject`, `createTenantWithUser`, `loginCookie`).
- `apps/worker/test/mirror-listener.test.ts` — padrão de teste do listener (Prisma real, fake queue).
- Spec completa: `docs/superpowers/specs/2026-09-17-automacao-disparo-design.md`.

---

### Task 1: Schema Prisma — modelos novos e ajustes

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Test: `packages/db/test/schema.test.ts` (novo)

**Interfaces:**
- Produz para as próximas tasks: modelos `AutomationRule`, `AutomationLog` (+ enum `AutomationLogAction`), `AutomationQueueItem` (+ enums `AutomationItemKind`, `AutomationQueueStatus`, campo `templateId` opcional para cupom), `Template.kind` (+ enum `TemplateKind`), `BatchItem.productId` opcional + `BatchItem.couponId` opcional.

- [ ] **Step 1: Adicionar os novos enums e modelos ao schema**

Em `packages/db/prisma/schema.prisma`, logo após o `model Coupon` (antes de `model ScheduledMessage`), adicionar:

```prisma
enum TemplateKind {
  PRODUCT
  COUPON
}

enum AutomationLogAction {
  DISCOVERED
  DISPATCHED
  SKIPPED
  ERROR
}

enum AutomationItemKind {
  PRODUCT
  COUPON
}

enum AutomationQueueStatus {
  PENDING
  DISPATCHED
  REMOVED
}

model AutomationRule {
  id              String                 @id @default(cuid())
  tenantId        String
  tenant          Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name            String
  enabled         Boolean                @default(false)
  marketplaces    MarketplaceKind[]
  keywords        String[]
  blockedKeywords String[]
  minDiscountPct  Int?
  minPrice        Decimal?               @db.Decimal(12, 2)
  maxPrice        Decimal?               @db.Decimal(12, 2)
  maxOffersPerDay Int                    @default(20)
  intervalMin     Int                    @default(60)
  sessionId       String
  session         WaSession              @relation(fields: [sessionId], references: [id])
  groupJids       String[]
  templateId      String
  template        Template               @relation("RuleProductTemplate", fields: [templateId], references: [id])
  mediaMode       MediaMode              @default(IMAGE)
  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @default(now()) @updatedAt
  logs            AutomationLog[]
  queueItems      AutomationQueueItem[]

  @@index([tenantId, enabled])
}

model AutomationLog {
  id          String              @id @default(cuid())
  tenantId    String
  tenant      Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ruleId      String
  rule        AutomationRule      @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  marketplace MarketplaceKind
  action      AutomationLogAction
  productId   String?
  reason      String?
  createdAt   DateTime            @default(now())

  @@index([tenantId, ruleId, createdAt])
}

model AutomationQueueItem {
  id           String                 @id @default(cuid())
  tenantId     String
  tenant       Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ruleId       String
  rule         AutomationRule         @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  kind         AutomationItemKind
  productId    String?
  product      Product?               @relation(fields: [productId], references: [id], onDelete: Cascade)
  couponId     String?
  coupon       Coupon?                @relation(fields: [couponId], references: [id], onDelete: Cascade)
  /** Só usado quando kind = COUPON: o template de cupom escolhido na inserção manual (independente do templateId de produto da regra). */
  templateId   String?
  template     Template?              @relation("QueueItemCouponTemplate", fields: [templateId], references: [id])
  manual       Boolean                @default(false)
  status       AutomationQueueStatus  @default(PENDING)
  addedAt      DateTime               @default(now())
  dispatchedAt DateTime?

  @@index([tenantId, ruleId, status, addedAt])
}
```

**Nota sobre as relações nomeadas:** como `Template` passa a ser referenciado de dois pontos diferentes (`AutomationRule.templateId` para produto e `AutomationQueueItem.templateId` para cupom), as relações usam nomes explícitos (`"RuleProductTemplate"`, `"QueueItemCouponTemplate"`) para o Prisma não reclamar de ambiguidade — isso é necessário porque ambas apontam para o mesmo modelo `Template`.

- [ ] **Step 2: Ajustar `Template`, `BatchItem`, `Product`, `Coupon`, `WaSession`, `Tenant` para as relações inversas**

Em `model Template`, adicionar o campo `kind` e as duas relações inversas nomeadas:

```prisma
model Template {
  id          String                @id @default(cuid())
  tenantId    String
  tenant      Tenant                @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name        String
  body        String
  isDefault   Boolean               @default(false)
  kind        TemplateKind          @default(PRODUCT)
  createdAt   DateTime              @default(now())
  batches     Batch[]
  mirrorRules MirrorRule[]
  automationRules      AutomationRule[]      @relation("RuleProductTemplate")
  automationQueueItems AutomationQueueItem[] @relation("QueueItemCouponTemplate")

  @@index([tenantId])
}
```

Em `model BatchItem`, tornar `productId`/`product` opcionais e adicionar `couponId`/`coupon`:

```prisma
model BatchItem {
  id        String          @id @default(cuid())
  batchId   String
  batch     Batch           @relation(fields: [batchId], references: [id], onDelete: Cascade)
  productId String?
  product   Product?        @relation(fields: [productId], references: [id])
  couponId  String?
  coupon    Coupon?         @relation(fields: [couponId], references: [id])
  order     Int
  runAt     DateTime
  status    BatchItemStatus @default(PENDING)
  error     String?
  sendLogs  SendLog[]

  @@unique([batchId, productId])
}
```

Em `model Product`, adicionar `automationQueueItems AutomationQueueItem[]` perto de `queueItems`/`batchItems`.

Em `model Coupon`, adicionar `automationQueueItems AutomationQueueItem[]` e `batchItems BatchItem[]`.

Em `model WaSession`, adicionar `automationRules AutomationRule[]` perto de `mirrorRules`.

Em `model Tenant`, adicionar `automationRules AutomationRule[]`, `automationLogs AutomationLog[]`, `automationQueueItems AutomationQueueItem[]` perto de `mirrorRules`/`mirrorLogs`.

- [ ] **Step 3: Gerar e aplicar a migration**

```bash
cd packages/db && npx prisma migrate dev --name automation_core_engine
```

Expected: migration criada em `packages/db/prisma/migrations/`, aplicada sem erro no banco de dev/test.

- [ ] **Step 4: Escrever teste de integração garantindo os relacionamentos**

Criar `packages/db/test/automation-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prisma } from '../src';

describe('schema de automação', () => {
  it('cria AutomationRule + AutomationQueueItem (produto) + AutomationQueueItem (cupom com template próprio)', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'automation-schema-test' } });
    const session = await prisma.waSession.create({
      data: { tenantId: tenant.id, label: 's' },
    });
    const template = await prisma.template.create({
      data: { tenantId: tenant.id, name: 't', body: 'oi', kind: 'PRODUCT' },
    });
    const couponTemplate = await prisma.template.create({
      data: { tenantId: tenant.id, name: 'tc', body: '{codigo}', kind: 'COUPON' },
    });
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: tenant.id,
        name: 'Eletrônicos',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });
    expect(rule.enabled).toBe(false);

    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        source: 'SHOPEE',
        title: 'Fone X',
        price: 99.9,
        images: ['https://x/img.png'],
        originalUrl: 'https://shopee.com.br/p/1',
        raw: {},
      },
    });
    const queueItem = await prisma.automationQueueItem.create({
      data: { tenantId: tenant.id, ruleId: rule.id, kind: 'PRODUCT', productId: product.id },
    });
    expect(queueItem.status).toBe('PENDING');

    const coupon = await prisma.coupon.create({
      data: { tenantId: tenant.id, store: 'AMAZON', code: 'PROMO10', description: '10% off' },
    });
    const couponItem = await prisma.automationQueueItem.create({
      data: {
        tenantId: tenant.id,
        ruleId: rule.id,
        kind: 'COUPON',
        couponId: coupon.id,
        templateId: couponTemplate.id,
        manual: true,
      },
    });
    expect(couponItem.manual).toBe(true);
    expect(couponItem.templateId).toBe(couponTemplate.id);
    expect(couponTemplate.kind).toBe('COUPON');

    await prisma.tenant.delete({ where: { id: tenant.id } });
  });
});
```

- [ ] **Step 5: Rodar o teste**

```bash
cd packages/db && npx vitest run test/automation-schema.test.ts
```

Expected: PASS (o `onDelete: Cascade` em `AutomationRule`/`AutomationQueueItem` limpa tudo ao deletar o tenant — sem erro de FK).

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): adiciona AutomationRule, AutomationLog, AutomationQueueItem e Template.kind"
```

---

### Task 2: `packages/shared` — enums, schemas Zod e eventos realtime

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/events.ts`
- Create: `packages/shared/src/automation.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/automation.test.ts`

**Interfaces:**
- Consome: nenhuma (independente da Task 1, mas roda em paralelo conceitualmente — pode ser feita antes ou depois).
- Produz: `TEMPLATE_KINDS`, `TemplateKind`, `AUTOMATION_LOG_ACTIONS`, `AutomationLogAction`, `AUTOMATION_ITEM_KINDS`, `AutomationItemKind`, `AUTOMATION_QUEUE_STATUSES`, `AutomationQueueStatus`, `automationRuleCreateSchema`, `automationRuleUpdateSchema`, `automationQueueLinkSchema`, `automationQueueCouponSchema`, tipos `AutomationRuleCreateBody`/`AutomationRuleUpdateBody`/`AutomationQueueLinkBody`/`AutomationQueueCouponBody`.

- [ ] **Step 1: Escrever o teste dos schemas Zod (falha primeiro)**

Criar `packages/shared/test/automation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { automationRuleCreateSchema, automationQueueLinkSchema, automationQueueCouponSchema } from '../src/automation';

describe('automationRuleCreateSchema', () => {
  it('aceita uma regra válida', () => {
    const parsed = automationRuleCreateSchema.parse({
      name: 'Eletrônicos até R$300',
      marketplaces: ['SHOPEE'],
      keywords: ['fone', 'carregador'],
      blockedKeywords: ['usado'],
      minDiscountPct: 20,
      maxPrice: 300,
      maxOffersPerDay: 15,
      intervalMin: 45,
      sessionId: 'sess1',
      groupJids: ['g1@g.us'],
      templateId: 'tpl1',
      mediaMode: 'IMAGE',
    });
    expect(parsed.keywords).toEqual(['fone', 'carregador']);
  });

  it('rejeita regra sem keywords', () => {
    expect(() =>
      automationRuleCreateSchema.parse({
        name: 'x',
        marketplaces: ['SHOPEE'],
        keywords: [],
        blockedKeywords: [],
        maxOffersPerDay: 15,
        intervalMin: 45,
        sessionId: 'sess1',
        groupJids: ['g1@g.us'],
        templateId: 'tpl1',
      }),
    ).toThrow();
  });

  it('rejeita marketplaces vazio', () => {
    expect(() =>
      automationRuleCreateSchema.parse({
        name: 'x',
        marketplaces: [],
        keywords: ['a'],
        blockedKeywords: [],
        maxOffersPerDay: 15,
        intervalMin: 45,
        sessionId: 'sess1',
        groupJids: ['g1@g.us'],
        templateId: 'tpl1',
      }),
    ).toThrow();
  });
});

describe('automationQueueLinkSchema', () => {
  it('exige uma URL', () => {
    expect(() => automationQueueLinkSchema.parse({ url: '' })).toThrow();
    expect(automationQueueLinkSchema.parse({ url: 'https://shopee.com.br/p/1' }).url).toBe(
      'https://shopee.com.br/p/1',
    );
  });
});

describe('automationQueueCouponSchema', () => {
  it('exige templateId e ou couponId ou dados de um cupom novo', () => {
    expect(() =>
      automationQueueCouponSchema.parse({ templateId: 'tpl-cupom' }),
    ).toThrow();
    const withExisting = automationQueueCouponSchema.parse({
      templateId: 'tpl-cupom',
      couponId: 'cp1',
    });
    expect(withExisting.couponId).toBe('cp1');
    const withNew = automationQueueCouponSchema.parse({
      templateId: 'tpl-cupom',
      coupon: { store: 'AMAZON', code: 'PROMO10', description: '10% off' },
    });
    expect(withNew.coupon?.code).toBe('PROMO10');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

```bash
cd packages/shared && npx vitest run test/automation.test.ts
```

Expected: FAIL — `Cannot find module '../src/automation'`.

- [ ] **Step 3: Adicionar os enums em `packages/shared/src/enums.ts`**

Ao final do arquivo, adicionar:

```typescript
export const TEMPLATE_KINDS = ['PRODUCT', 'COUPON'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const AUTOMATION_LOG_ACTIONS = ['DISCOVERED', 'DISPATCHED', 'SKIPPED', 'ERROR'] as const;
export type AutomationLogAction = (typeof AUTOMATION_LOG_ACTIONS)[number];

export const AUTOMATION_ITEM_KINDS = ['PRODUCT', 'COUPON'] as const;
export type AutomationItemKind = (typeof AUTOMATION_ITEM_KINDS)[number];

export const AUTOMATION_QUEUE_STATUSES = ['PENDING', 'DISPATCHED', 'REMOVED'] as const;
export type AutomationQueueStatus = (typeof AUTOMATION_QUEUE_STATUSES)[number];
```

- [ ] **Step 4: Criar `packages/shared/src/automation.ts`**

```typescript
import { z } from 'zod';
import { MARKETPLACE_KINDS, MEDIA_MODES } from './enums';

export const automationRuleCreateSchema = z.object({
  name: z.string().min(1).max(80),
  marketplaces: z.array(z.enum(MARKETPLACE_KINDS)).min(1),
  keywords: z.array(z.string().min(1)).min(1),
  blockedKeywords: z.array(z.string().min(1)).default([]),
  minDiscountPct: z.number().int().min(0).max(100).optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  maxOffersPerDay: z.number().int().min(1).max(200).default(20),
  intervalMin: z.number().int().min(5).max(1440).default(60),
  sessionId: z.string().min(1),
  groupJids: z.array(z.string().min(1)).min(1),
  templateId: z.string().min(1),
  mediaMode: z.enum(MEDIA_MODES).default('IMAGE'),
});
export type AutomationRuleCreateBody = z.infer<typeof automationRuleCreateSchema>;

export const automationRuleUpdateSchema = automationRuleCreateSchema.partial();
export type AutomationRuleUpdateBody = z.infer<typeof automationRuleUpdateSchema>;

export const automationQueueLinkSchema = z.object({ url: z.string().min(1).url() });
export type AutomationQueueLinkBody = z.infer<typeof automationQueueLinkSchema>;

export const automationQueueCouponSchema = z
  .object({
    templateId: z.string().min(1),
    couponId: z.string().min(1).optional(),
    coupon: z
      .object({
        store: z.enum(MARKETPLACE_KINDS),
        code: z.string().min(1),
        description: z.string().min(1),
        expiresAt: z.string().datetime().optional(),
        sourceUrl: z.string().url().optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.couponId && !v.coupon) {
      ctx.addIssue({
        code: 'custom',
        path: ['couponId'],
        message: 'informe couponId ou os dados de um cupom novo',
      });
    }
  });
export type AutomationQueueCouponBody = z.infer<typeof automationQueueCouponSchema>;
```

- [ ] **Step 5: Exportar o novo módulo em `packages/shared/src/index.ts`**

Adicionar `export * from './automation';` junto aos outros `export *`.

- [ ] **Step 6: Adicionar os dois novos eventos realtime em `packages/shared/src/events.ts`**

No union `RealtimeEvent`, logo após `| { type: 'mirror.rules.changed' }`, adicionar:

```typescript
  | { type: 'automation.rules.changed' }
  | { type: 'automation.queue.updated'; ruleId: string }
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

```bash
cd packages/shared && npx vitest run test/automation.test.ts
```

Expected: PASS (3 describe blocks, todos verdes).

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): schemas Zod, enums e eventos realtime da automação"
```

---

### Task 3: `packages/core` — portão de validação e template de cupom

**Files:**
- Create: `packages/core/src/eligibility.ts`
- Modify: `packages/core/src/template.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/eligibility.test.ts` (novo)
- Test: `packages/core/test/coupon-template.test.ts` (novo)

**Interfaces:**
- Consome: nenhuma das tasks anteriores (puro, sem I/O).
- Produz: `isEligibleProduct(input: EligibleProductInput): EligibilityResult`, `isEligibleCoupon(input: EligibleCouponInput): EligibilityResult`, `renderCouponTemplate(body: string, coupon: CouponData, ctx: { now: string }): string`. Usados pela Task 6 (scheduler) e Task 5 (`send-offer`).

- [ ] **Step 1: Escrever o teste do portão de validação**

Criar `packages/core/test/eligibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isEligibleProduct, isEligibleCoupon } from '../src/eligibility';

const baseProduct = {
  title: 'Fone Bluetooth',
  price: 99.9,
  images: ['https://x/img.png'],
  originalUrl: 'https://shopee.com.br/p/1',
  raw: {} as Record<string, unknown>,
};

describe('isEligibleProduct', () => {
  it('aceita produto completo', () => {
    expect(isEligibleProduct(baseProduct)).toEqual({ ok: true });
  });

  it('rejeita produto ainda em enriquecimento', () => {
    const r = isEligibleProduct({ ...baseProduct, raw: { pendingEnrich: true } });
    expect(r).toEqual({ ok: false, reason: 'pending-enrich' });
  });

  it('rejeita título vazio ou placeholder', () => {
    expect(isEligibleProduct({ ...baseProduct, title: '' })).toEqual({
      ok: false,
      reason: 'empty-title',
    });
    expect(isEligibleProduct({ ...baseProduct, title: 'Importando…' })).toEqual({
      ok: false,
      reason: 'empty-title',
    });
  });

  it('rejeita preço zero ou negativo', () => {
    expect(isEligibleProduct({ ...baseProduct, price: 0 })).toEqual({
      ok: false,
      reason: 'invalid-price',
    });
  });

  it('rejeita sem imagens', () => {
    expect(isEligibleProduct({ ...baseProduct, images: [] })).toEqual({
      ok: false,
      reason: 'no-images',
    });
  });

  it('rejeita URL inválida', () => {
    expect(isEligibleProduct({ ...baseProduct, originalUrl: 'não é url' })).toEqual({
      ok: false,
      reason: 'invalid-url',
    });
  });
});

describe('isEligibleCoupon', () => {
  it('aceita cupom sem validade', () => {
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: null })).toEqual({ ok: true });
  });

  it('aceita cupom com validade futura', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: future })).toEqual({ ok: true });
  });

  it('rejeita cupom expirado', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isEligibleCoupon({ code: 'PROMO10', expiresAt: past })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejeita código vazio', () => {
    expect(isEligibleCoupon({ code: '', expiresAt: null })).toEqual({
      ok: false,
      reason: 'empty-code',
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd packages/core && npx vitest run test/eligibility.test.ts
```

Expected: FAIL — módulo `../src/eligibility` não existe.

- [ ] **Step 3: Implementar `packages/core/src/eligibility.ts`**

```typescript
export type EligibilityResult = { ok: true } | { ok: false; reason: string };

export interface EligibleProductInput {
  title: string;
  price: number;
  images: string[];
  originalUrl: string;
  raw: Record<string, unknown>;
}

export function isEligibleProduct(p: EligibleProductInput): EligibilityResult {
  if (p.raw && p.raw['pendingEnrich'] === true) return { ok: false, reason: 'pending-enrich' };
  if (!p.title.trim() || p.title.trim() === 'Importando…')
    return { ok: false, reason: 'empty-title' };
  if (!(p.price > 0)) return { ok: false, reason: 'invalid-price' };
  if (p.images.length === 0) return { ok: false, reason: 'no-images' };
  try {
    new URL(p.originalUrl);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  return { ok: true };
}

export interface EligibleCouponInput {
  code: string;
  expiresAt: string | null;
}

export function isEligibleCoupon(c: EligibleCouponInput): EligibilityResult {
  if (!c.code.trim()) return { ok: false, reason: 'empty-code' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now())
    return { ok: false, reason: 'expired' };
  return { ok: true };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd packages/core && npx vitest run test/eligibility.test.ts
```

Expected: PASS (10 testes).

- [ ] **Step 5: Escrever teste de `renderCouponTemplate`**

Criar `packages/core/test/coupon-template.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderCouponTemplate } from '../src/template';

describe('renderCouponTemplate', () => {
  it('substitui as variáveis do cupom', () => {
    const body = '🎟️ *{codigo}* na {loja}! {descricao} — válido até {validade}';
    const out = renderCouponTemplate(
      body,
      {
        store: 'AMAZON',
        code: 'PROMO10',
        description: '10% OFF em eletrônicos',
        expiresAt: '2026-12-31T23:59:59.000Z',
      },
      { now: '2026-09-17T12:00:00.000Z' },
    );
    expect(out).toContain('PROMO10');
    expect(out).toContain('10% OFF em eletrônicos');
    expect(out).toContain('31/12/2026');
  });

  it('mostra "sem validade definida" quando expiresAt é nulo', () => {
    const out = renderCouponTemplate(
      'Validade: {validade}',
      { store: 'SHOPEE', code: 'X', description: 'd', expiresAt: null },
      { now: '2026-09-17T12:00:00.000Z' },
    );
    expect(out).toBe('Validade: sem validade definida');
  });
});
```

- [ ] **Step 6: Rodar e confirmar falha**

```bash
cd packages/core && npx vitest run test/coupon-template.test.ts
```

Expected: FAIL — `renderCouponTemplate` não exportado.

- [ ] **Step 7: Implementar `renderCouponTemplate` em `packages/core/src/template.ts`**

`DateTime` já está importado no topo do arquivo (usado por `flashSaleLabel`) e `VAR_RE` já está definido logo acima de `renderTemplate` — reaproveitar os dois, sem reimportar. Ao final do arquivo, adicionar:

```typescript
export interface CouponData {
  store: string;
  code: string;
  description: string;
  expiresAt: string | null;
}

function buildCouponVars(c: CouponData): Record<string, string> {
  return {
    codigo: c.code,
    loja: c.store,
    descricao: c.description,
    validade: c.expiresAt
      ? DateTime.fromISO(c.expiresAt).toFormat('dd/MM/yyyy')
      : 'sem validade definida',
  };
}

export function renderCouponTemplate(
  body: string,
  coupon: CouponData,
  _ctx: { now: string },
): string {
  const vars = buildCouponVars(coupon);
  return body.replace(VAR_RE, (m, name: string) => vars[name] ?? m);
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

```bash
cd packages/core && npx vitest run test/coupon-template.test.ts
```

Expected: PASS (2 testes).

- [ ] **Step 9: Exportar o novo módulo em `packages/core/src/index.ts`**

Adicionar `export * from './eligibility';` (o `template.ts` já é exportado).

- [ ] **Step 10: Rodar a suíte inteira do pacote**

```bash
cd packages/core && npx vitest run
```

Expected: PASS, nenhuma regressão nos testes já existentes de `template.ts`.

- [ ] **Step 11: Commit**

```bash
git add packages/core
git commit -m "feat(core): portão de elegibilidade (produto/cupom) e renderCouponTemplate"
```

---

### Task 4: Worker — mensagem de texto puro no gateway do WhatsApp

**Files:**
- Modify: `apps/worker/src/wa/gateway.ts`
- Modify: `apps/worker/src/wa/baileys-gateway.ts`
- Test: `apps/worker/test/baileys-gateway.test.ts` (criar; verificar antes se já existe algum teste de gateway para seguir o mesmo padrão de mock do `@whiskeysockets/baileys`)

**Interfaces:**
- Produz: `OutgoingMessage` passa a incluir `OutgoingText = { kind: 'text'; text: string }`, usado pela Task 5.

- [ ] **Step 1: Localizar a definição atual de `OutgoingMessage` e o switch de envio**

```bash
grep -n "OutgoingImage\|OutgoingPreview\|OutgoingMessage\|msg.kind" apps/worker/src/wa/gateway.ts apps/worker/src/wa/baileys-gateway.ts
```

- [ ] **Step 2: Adicionar o novo variant em `apps/worker/src/wa/gateway.ts`**

Localizar a definição de `OutgoingMessage` (linha ~15) e alterar para:

```typescript
export interface OutgoingText {
  kind: 'text';
  text: string;
}

export type OutgoingMessage = OutgoingImage | OutgoingPreview | OutgoingText;
```

- [ ] **Step 3: Implementar o envio de texto em `apps/worker/src/wa/baileys-gateway.ts`**

No método que hoje despacha por `msg.kind` dentro de `sendMessage` (branches `'image'`/`'preview'` já existentes), adicionar o branch `'text'` seguindo exatamente o mesmo formato de retorno `{ messageId: sent?.key.id ?? '' }` já usado pelos outros dois:

```typescript
if (msg.kind === 'text') {
  const sent = await sock.sendMessage(jid, { text: msg.text });
  return { messageId: sent?.key.id ?? '' };
}
```

- [ ] **Step 4: Escrever teste de integração do novo kind**

Criar `apps/worker/test/baileys-gateway.test.ts` reaproveitando o mesmo mock de `makeWASocket`/`@whiskeysockets/baileys` já usado em outros testes do worker que exercitam `BaileysGateway.sendMessage` (buscar com `grep -rn "makeWASocket" apps/worker/test` antes de escrever, para copiar o setup exato):

```typescript
it('envia mensagem de texto puro', async () => {
  const result = await gateway.sendMessage(sessionId, 'g@g.us', {
    kind: 'text',
    text: 'Oi, isso é um teste',
  });
  expect(result.messageId).toBeTruthy();
});
```

- [ ] **Step 5: Rodar o teste**

```bash
cd apps/worker && npx vitest run test/baileys-gateway.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/wa/gateway.ts apps/worker/src/wa/baileys-gateway.ts apps/worker/test
git commit -m "feat(worker): suporte a envio de mensagem de texto puro no gateway WhatsApp"
```

---

### Task 5: Worker — `sendOffer` aceita `BatchItem` de cupom

**Files:**
- Modify: `apps/worker/src/processors/send-offer.ts`
- Test: `apps/worker/test/send-offer.test.ts` (adicionar casos — arquivo já existe, seguir o setup de tenant/session/product já presente nele)

**Interfaces:**
- Consome: `OutgoingMessage` (Task 4), `renderCouponTemplate`/`isEligibleCoupon` (Task 3), `BatchItem.couponId`/`Coupon` (Task 1).
- Produz: `sendOffer` despacha corretamente `BatchItem` com `couponId` preenchido, sem exigir `productId`.

- [ ] **Step 1: Ler o teste existente para reaproveitar o setup**

```bash
sed -n '1,60p' apps/worker/test/send-offer.test.ts
```

Usar exatamente os mesmos helpers de setup (tenant, sessão CONNECTED, template, grupo) já presentes nesse arquivo para o novo teste de cupom.

- [ ] **Step 2: Escrever o teste do caminho de cupom (falha primeiro)**

Adicionar ao `apps/worker/test/send-offer.test.ts`:

```typescript
it('envia mensagem de cupom sem produto associado', async () => {
  const couponTemplate = await prisma.template.create({
    data: { tenantId, name: 'cupom', body: '🎟️ {codigo} na {loja}: {descricao}', kind: 'COUPON' },
  });
  const coupon = await prisma.coupon.create({
    data: { tenantId, store: 'AMAZON', code: 'PROMO10', description: '10% off' },
  });
  const batch = await prisma.batch.create({
    data: {
      tenantId,
      sessionId,
      templateId: couponTemplate.id,
      name: 'cupom-batch',
      groupJids: ['g1@g.us'],
      intervalMin: 60,
      items: { create: [{ order: 0, runAt: new Date(), couponId: coupon.id }] },
    },
    include: { items: true },
  });
  const itemId = batch.items[0]!.id;

  const sent: unknown[] = [];
  const gateway = {
    sendMessage: async (_s: string, _jid: string, msg: unknown) => {
      sent.push(msg);
      return { messageId: 'M-CUPOM' };
    },
  };
  const result = await sendOffer({ gateway: gateway as never, shopee: {} as never }, itemId);
  expect(result).toEqual({ outcome: 'sent', groups: 1 });
  expect(sent).toEqual([{ kind: 'text', text: expect.stringContaining('PROMO10') }]);

  const updated = await prisma.batchItem.findUniqueOrThrow({ where: { id: itemId } });
  expect(updated.status).toBe('SENT');
});
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
cd apps/worker && npx vitest run test/send-offer.test.ts -t "cupom"
```

Expected: FAIL (hoje `sendOffer` pressupõe `item.product` sempre presente e quebra com `couponId`).

- [ ] **Step 4: Extrair o laço de envio por grupo para uma função reaproveitável**

Em `apps/worker/src/processors/send-offer.ts`, adicionar no topo:

```typescript
import { renderCouponTemplate, isEligibleCoupon } from '@afilados/core';
```

Adicionar, **acima** da função `sendOffer`, a função auxiliar que move (não duplica) o laço de envio por grupo hoje existente dentro de `sendOffer` (o trecho que vai de `const existing = await prisma.sendLog.findMany(...)` até `return { outcome: 'sent', groups: sentCount };`):

```typescript
async function sendPlainMessages(
  deps: SendOfferDeps,
  item: { id: string; productId: string | null },
  batch: { id: string; sessionId: string; groupJids: string[] },
  tenantId: string,
  message: OutgoingMessage,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
  rng: () => number,
): Promise<SendOfferResult> {
  const settingsRows = await prisma.setting.findMany({ where: { tenantId } });
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value])) as Record<
    string,
    unknown
  >;
  const ratePerMin = Number(settings.globalRateLimitPerMin ?? 6);
  const bucket = new TokenBucket(getRedis(), `wa:rate:${batch.sessionId}`, ratePerMin);

  const existing = await prisma.sendLog.findMany({
    where: { batchItemId: item.id, waMessageId: { not: null } },
  });
  const done = new Set(existing.map((l) => l.groupJid));
  let sentCount = 0;
  let first = true;
  for (const groupJid of batch.groupJids) {
    if (done.has(groupJid)) continue;
    if (!first) await sleep(jitter(GROUP_GAP_MS, 0.15, rng));
    first = false;
    await waitForToken(bucket, sleep);
    try {
      const { messageId } = await deps.gateway.sendMessage(batch.sessionId, groupJid, message);
      await prisma.sendLog.upsert({
        where: { batchItemId_groupJid: { batchItemId: item.id, groupJid } },
        update: { waMessageId: messageId, status: 'SENT', error: null, sentAt: now() },
        create: { tenantId, batchItemId: item.id, groupJid, waMessageId: messageId, status: 'SENT' },
      });
      sentCount++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log.warn({ batchItemId: item.id, groupJid, error }, 'falha ao enviar');
      await prisma.sendLog.upsert({
        where: { batchItemId_groupJid: { batchItemId: item.id, groupJid } },
        update: { status: 'ERROR', error, sentAt: now() },
        create: { tenantId, batchItemId: item.id, groupJid, status: 'ERROR', error },
      });
    }
  }
  const anySent = sentCount > 0 || done.size > 0;
  const status = anySent ? 'SENT' : 'ERROR';
  await prisma.batchItem.update({
    where: { id: item.id },
    data: { status, error: anySent ? null : 'nenhum grupo recebeu' },
  });
  if (item.productId) {
    await prisma.queueItem.updateMany({
      where: { tenantId, productId: item.productId },
      data: { status },
    });
  }
  await publishEvent(tenantId, { type: 'batch.item', batchId: batch.id, itemId: item.id, status });
  await finalizeBatchIfComplete(batch.id);
  await publishProgress(batch.id, tenantId);
  return { outcome: 'sent', groups: sentCount };
}
```

Remover esse mesmo trecho de dentro de `sendOffer` (ele não deve mais existir duplicado ali).

- [ ] **Step 5: Adicionar o desvio de cupom em `sendOffer` e chamar `sendPlainMessages` para os dois casos**

Logo após `const { batch, product } = item;` trocar para desestruturar também `coupon`:

```typescript
const { batch, product, coupon } = item;
```

(A query no início de `sendOffer` precisa incluir `coupon: true` junto de `product: true` — ajustar o `include` do `prisma.batchItem.findUnique` no topo da função.)

No bloco `try`, **antes** do trecho `// Link de afiliado (uma vez por item)`, adicionar:

```typescript
  try {
    if (item.couponId && coupon) {
      const elig = isEligibleCoupon({
        code: coupon.code,
        expiresAt: coupon.expiresAt?.toISOString() ?? null,
      });
      if (!elig.ok) throw new Error(`cupom inelegível: ${elig.reason}`);
      const text = renderCouponTemplate(
        batch.template.body,
        {
          store: coupon.store,
          code: coupon.code,
          description: coupon.description,
          expiresAt: coupon.expiresAt?.toISOString() ?? null,
        },
        { now: t.toISOString() },
      );
      return sendPlainMessages(
        deps,
        { id: item.id, productId: null },
        batch,
        tenantId,
        { kind: 'text', text },
        now,
        sleep,
        rng,
      );
    }
    if (!product) throw new Error('BatchItem sem produto nem cupom');
    // Link de afiliado (uma vez por item)
    let affiliateLink = product.originalUrl;
```

No ponto onde hoje o código monta `message` (`OutgoingMessage` de imagem/preview) e em seguida faz o laço de envio, trocar o final da função (do `const existing = ...` em diante, já removido no Step 4) por:

```typescript
    return sendPlainMessages(
      deps,
      { id: item.id, productId: product.id },
      batch,
      tenantId,
      message,
      now,
      sleep,
      rng,
    );
```

O `catch` externo de `sendOffer` (que grava `BatchItem.status = 'ERROR'` em caso de exceção) continua envolvendo toda essa lógica sem alteração — ele já cobre o `throw` de cupom inelegível.

- [ ] **Step 6: Rodar o teste de cupom novamente**

```bash
cd apps/worker && npx vitest run test/send-offer.test.ts -t "cupom"
```

Expected: PASS.

- [ ] **Step 7: Rodar a suíte completa de `send-offer.test.ts`**

```bash
cd apps/worker && npx vitest run test/send-offer.test.ts
```

Expected: PASS em todos os testes (produto e cupom) — nenhuma regressão no fluxo de produto que já existia.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/processors/send-offer.ts apps/worker/test/send-offer.test.ts
git commit -m "feat(worker): sendOffer despacha BatchItem de cupom (sem produto associado)"
```

---

### Task 6: Worker — `AutomationScheduler`

**Files:**
- Create: `apps/worker/src/lib/queue-helpers.ts`
- Create: `apps/worker/src/automation/scheduler.ts`
- Test: `apps/worker/test/automation-scheduler.test.ts`

**Interfaces:**
- Consome: `isEligibleProduct`/`isEligibleCoupon` (Task 3), `isWithinOperatingWindow` (`@afilados/core`, já existe), `AutomationRule`/`AutomationLog`/`AutomationQueueItem` (Task 1), `getQueue` (`apps/worker/src/lib/redis.ts`, já existe).
- Produz: `class AutomationScheduler { start(): Promise<void>; stop(): void; reload(): Promise<void>; ruleCount(): number; ruleNames(): string[]; tick(): Promise<void> }`, usada pela Task 7 (`discoverForRule` + `main.ts`).

- [ ] **Step 1: Criar o helper de enfileiramento (`apps/worker/src/lib/queue-helpers.ts`)**

```typescript
import { QUEUE_SEND_OFFER, type SendOfferJob } from '@afilados/shared';
import { getQueue } from './redis';

export async function enqueueSendOffer(tenantId: string, batchItemId: string) {
  const q = getQueue<SendOfferJob>(QUEUE_SEND_OFFER);
  await q.add(
    'send-offer',
    { tenantId, batchItemId },
    {
      jobId: batchItemId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
}
```

- [ ] **Step 2: Escrever o teste do scheduler (falha primeiro)**

Criar `apps/worker/test/automation-scheduler.test.ts` seguindo o setup de `apps/worker/test/mirror-listener.test.ts` (tenant/session/grupo reais via Prisma). Nesta fase, o construtor recebe `discover` já como stub (ligação real com `discoverForRule` acontece na Task 7):

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@afilados/db';
import { AutomationScheduler } from '../src/automation/scheduler';

let tenantId: string;
let sessionId: string;
let templateId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'automation-scheduler-test' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 's', status: 'CONNECTED' } })).id;
  templateId = (await prisma.template.create({ data: { tenantId, name: 't', body: '{titulo} {link}' } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('AutomationScheduler', () => {
  it('despacha item manual antes de descobrir automaticamente', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r1',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        intervalMin: 5,
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const product = await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        title: 'Fone Manual',
        price: 50,
        images: ['https://x/1.png'],
        originalUrl: 'https://shopee.com.br/p/manual',
        raw: {},
      },
    });
    await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: true },
    });

    const enqueued: string[] = [];
    const discoverCalls: string[] = [];
    const scheduler = new AutomationScheduler({
      enqueue: async (_tenantId, batchItemId) => {
        enqueued.push(batchItemId);
      },
      discover: async (r) => {
        discoverCalls.push(r.id);
      },
    });
    await scheduler.reload();
    expect(scheduler.ruleCount()).toBe(1);
    await scheduler.tick();

    expect(enqueued.length).toBe(1);
    expect(discoverCalls.length).toBe(0); // item manual pulou a descoberta
    const queueItem = await prisma.automationQueueItem.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(queueItem.status).toBe('DISPATCHED');
    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('DISPATCHED');
  });

  it('pula produto inelegível (pendingEnrich) e loga SKIPPED sem despachar', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r2',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        intervalMin: 5,
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const product = await prisma.product.create({
      data: {
        tenantId,
        source: 'SHOPEE',
        title: 'Importando…',
        price: 0,
        images: [],
        originalUrl: 'https://shopee.com.br/p/pendente',
        raw: { pendingEnrich: true },
      },
    });
    await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: true },
    });

    const enqueued: string[] = [];
    const scheduler = new AutomationScheduler({
      enqueue: async (_tenantId, batchItemId) => {
        enqueued.push(batchItemId);
      },
      discover: async () => {},
    });
    await scheduler.reload();
    await scheduler.tick();

    expect(enqueued.length).toBe(0);
    const queueItem = await prisma.automationQueueItem.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(queueItem.status).toBe('PENDING');
    const log = await prisma.automationLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log.action).toBe('SKIPPED');
  });

  it('não recarrega regra desabilitada', async () => {
    await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r3-desabilitada',
        enabled: false,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const scheduler = new AutomationScheduler({ enqueue: vi.fn(), discover: async () => {} });
    await scheduler.reload();
    expect(scheduler.ruleNames()).not.toContain('r3-desabilitada');
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
cd apps/worker && npx vitest run test/automation-scheduler.test.ts
```

Expected: FAIL — `../src/automation/scheduler` não existe.

- [ ] **Step 4: Implementar `apps/worker/src/automation/scheduler.ts`**

```typescript
import pino from 'pino';
import { prisma } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import { isEligibleProduct, isEligibleCoupon, isWithinOperatingWindow } from '@afilados/core';
import { enqueueSendOffer } from '../lib/queue-helpers';

const log = pino({ name: 'automation-scheduler' });

export interface AutomationSchedulerDeps {
  enqueue?: (tenantId: string, batchItemId: string) => Promise<void>;
  /** Dispara a descoberta (busca por keyword) e popula AutomationQueueItem para a regra. */
  discover?: (rule: AutomationRule) => Promise<void>;
  now?: () => Date;
}

export class AutomationScheduler {
  private rules: AutomationRule[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly enqueue: (tenantId: string, batchItemId: string) => Promise<void>;
  private readonly discover: (rule: AutomationRule) => Promise<void>;
  private readonly now: () => Date;

  constructor(deps: AutomationSchedulerDeps = {}) {
    this.enqueue = deps.enqueue ?? ((tenantId, batchItemId) => enqueueSendOffer(tenantId, batchItemId));
    this.discover = deps.discover ?? (async () => {});
    this.now = deps.now ?? (() => new Date());
  }

  async start() {
    await this.reload();
    this.timer = setInterval(() => {
      void this.tick().catch((e) => log.error(e, 'falha no tick de automação'));
    }, 30_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async reload() {
    this.rules = await prisma.automationRule.findMany({ where: { enabled: true } });
  }

  ruleCount() {
    return this.rules.length;
  }

  ruleNames() {
    return this.rules.map((r) => r.name);
  }

  async tick() {
    for (const rule of this.rules) {
      await this.tickRule(rule).catch((e) =>
        log.error({ ruleId: rule.id, err: e }, 'falha ao processar regra de automação'),
      );
    }
  }

  private async tickRule(rule: AutomationRule) {
    const now = this.now();

    const lastDispatch = await prisma.automationLog.findFirst({
      where: { ruleId: rule.id, action: 'DISPATCHED' },
      orderBy: { createdAt: 'desc' },
    });
    if (lastDispatch) {
      const elapsedMin = (now.getTime() - lastDispatch.createdAt.getTime()) / 60_000;
      if (elapsedMin < rule.intervalMin) return;
    }

    const window = await prisma.operatingWindow.findUnique({ where: { tenantId: rule.tenantId } });
    if (
      window &&
      !isWithinOperatingWindow(now, {
        startTime: window.startTime,
        endTime: window.endTime,
        timezone: window.timezone,
        enabled: window.enabled,
      })
    ) {
      return;
    }

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const dispatchedToday = await prisma.automationLog.count({
      where: { ruleId: rule.id, action: 'DISPATCHED', createdAt: { gte: startOfDay } },
    });
    if (dispatchedToday >= rule.maxOffersPerDay) return;

    await this.dispatchNext(rule);
  }

  private async dispatchNext(rule: AutomationRule) {
    const manual = await prisma.automationQueueItem.findFirst({
      where: { ruleId: rule.id, manual: true, status: 'PENDING' },
      orderBy: { addedAt: 'asc' },
      include: { product: true, coupon: true },
    });

    let candidate = manual;
    if (!candidate) {
      await this.discover(rule);
      candidate = await prisma.automationQueueItem.findFirst({
        where: { ruleId: rule.id, manual: false, status: 'PENDING' },
        orderBy: { addedAt: 'asc' },
        include: { product: true, coupon: true },
      });
      if (!candidate) {
        await prisma.automationLog.create({
          data: {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            marketplace: rule.marketplaces[0] ?? 'SHOPEE',
            action: 'DISCOVERED',
            reason: 'nenhum produto elegível encontrado',
          },
        });
        return;
      }
    }

    const marketplaceForLog = candidate.product?.source ?? candidate.coupon?.store ?? rule.marketplaces[0]!;

    if (candidate.kind === 'PRODUCT') {
      if (!candidate.product) return;
      const elig = isEligibleProduct({
        title: candidate.product.title,
        price: Number(candidate.product.price),
        images: candidate.product.images,
        originalUrl: candidate.product.originalUrl,
        raw: candidate.product.raw as Record<string, unknown>,
      });
      if (!elig.ok) {
        await prisma.automationLog.create({
          data: {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            marketplace: marketplaceForLog,
            action: 'SKIPPED',
            productId: candidate.productId,
            reason: elig.reason,
          },
        });
        return;
      }
    } else {
      if (!candidate.coupon) return;
      const elig = isEligibleCoupon({
        code: candidate.coupon.code,
        expiresAt: candidate.coupon.expiresAt?.toISOString() ?? null,
      });
      if (!elig.ok) {
        await prisma.automationLog.create({
          data: {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            marketplace: marketplaceForLog,
            action: 'SKIPPED',
            reason: elig.reason,
          },
        });
        return;
      }
    }

    const batchTemplateId = candidate.kind === 'COUPON' ? candidate.templateId ?? rule.templateId : rule.templateId;

    const batch = await prisma.batch.create({
      data: {
        tenantId: rule.tenantId,
        sessionId: rule.sessionId,
        templateId: batchTemplateId,
        name: `Automação: ${rule.name}`,
        groupJids: rule.groupJids,
        intervalMin: rule.intervalMin,
        mediaMode: rule.mediaMode,
        items: {
          create: [
            {
              order: 0,
              runAt: this.now(),
              productId: candidate.kind === 'PRODUCT' ? candidate.productId : null,
              couponId: candidate.kind === 'COUPON' ? candidate.couponId : null,
            },
          ],
        },
      },
      include: { items: true },
    });

    try {
      await this.enqueue(rule.tenantId, batch.items[0]!.id);
      await prisma.automationQueueItem.update({
        where: { id: candidate.id },
        data: { status: 'DISPATCHED', dispatchedAt: this.now() },
      });
      await prisma.automationLog.create({
        data: {
          tenantId: rule.tenantId,
          ruleId: rule.id,
          marketplace: marketplaceForLog,
          action: 'DISPATCHED',
          productId: candidate.productId,
        },
      });
    } catch (e) {
      await prisma.batch.update({ where: { id: batch.id }, data: { status: 'CANCELLED' } });
      await prisma.automationLog.create({
        data: {
          tenantId: rule.tenantId,
          ruleId: rule.id,
          marketplace: marketplaceForLog,
          action: 'ERROR',
          reason: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }
}
```

- [ ] **Step 5: Rodar o teste**

```bash
cd apps/worker && npx vitest run test/automation-scheduler.test.ts
```

Expected: PASS nos 3 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/lib/queue-helpers.ts apps/worker/src/automation apps/worker/test/automation-scheduler.test.ts
git commit -m "feat(worker): AutomationScheduler com prioridade manual e portão de elegibilidade"
```

---

### Task 7: Worker — descoberta Shopee real + `main.ts`

**Files:**
- Create: `apps/worker/src/automation/discovery.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/automation-discovery.test.ts`

**Interfaces:**
- Consome: `createShopeeAdapter` (`@afilados/marketplaces`, já existe), `decryptJson` (`@afilados/db`, já existe), `AutomationScheduler` (Task 6).
- Produz: `discoverForRule(rule: AutomationRule, deps?: DiscoveryDeps): Promise<void>` — cria `Product` + `AutomationQueueItem` para os resultados elegíveis, ligado ao `AutomationScheduler` real.

- [ ] **Step 1: Escrever o teste da descoberta Shopee (falha primeiro)**

Criar `apps/worker/test/automation-discovery.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { discoverForRule } from '../src/automation/discovery';

let tenantId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'automation-discovery-test' } })).id;
  await prisma.marketplaceConnection.create({
    data: {
      tenantId,
      kind: 'SHOPEE',
      status: 'OK',
      encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }),
    },
  });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('discoverForRule (Shopee)', () => {
  it('cria Product + AutomationQueueItem para resultados elegíveis e filtra bloqueados', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-rule',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: ['usado'],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 's' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 't', body: 'x' } })).id,
      },
    });

    const searchResults = [
      {
        source: 'SHOPEE' as const,
        externalId: '1',
        title: 'Fone Bluetooth Novo',
        price: 50,
        images: ['https://x/1.png'],
        shipping: 'FREE' as const,
        originalUrl: 'https://shopee.com.br/p/1',
        raw: {},
      },
      {
        source: 'SHOPEE' as const,
        externalId: '2',
        title: 'Fone usado bom estado',
        price: 20,
        images: ['https://x/2.png'],
        shipping: 'FREE' as const,
        originalUrl: 'https://shopee.com.br/p/2',
        raw: {},
      },
    ];

    await discoverForRule(rule, { searchShopee: async () => searchResults });

    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId: rule.id },
      include: { product: true },
    });
    expect(items.length).toBe(1);
    expect(items[0]!.product!.title).toBe('Fone Bluetooth Novo');
  });

  it('não duplica AutomationQueueItem se o produto já estiver na fila da regra', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'discovery-rule-2',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: (await prisma.waSession.create({ data: { tenantId, label: 's2' } })).id,
        groupJids: ['g@g.us'],
        templateId: (await prisma.template.create({ data: { tenantId, name: 't2', body: 'x' } })).id,
      },
    });
    const sameResult = {
      source: 'SHOPEE' as const,
      externalId: '99',
      title: 'Fone repetido',
      price: 30,
      images: ['https://x/9.png'],
      shipping: 'FREE' as const,
      originalUrl: 'https://shopee.com.br/p/99',
      raw: {},
    };
    await discoverForRule(rule, { searchShopee: async () => [sameResult] });
    await discoverForRule(rule, { searchShopee: async () => [sameResult] });

    const items = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    expect(items.length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd apps/worker && npx vitest run test/automation-discovery.test.ts
```

Expected: FAIL — módulo `../src/automation/discovery` não existe.

- [ ] **Step 3: Implementar `apps/worker/src/automation/discovery.ts`**

```typescript
import { prisma, decryptJson } from '@afilados/db';
import type { AutomationRule } from '@afilados/db';
import { createShopeeAdapter, type ShopeeCredentials } from '@afilados/marketplaces';
import type { ProductData } from '@afilados/shared';

export interface DiscoveryDeps {
  searchShopee?: (creds: ShopeeCredentials, keyword: string) => Promise<ProductData[]>;
}

function matchesFilters(
  p: ProductData,
  rule: Pick<AutomationRule, 'blockedKeywords' | 'minDiscountPct' | 'minPrice' | 'maxPrice'>,
): boolean {
  const title = p.title.toLowerCase();
  if (rule.blockedKeywords.some((k) => title.includes(k.toLowerCase()))) return false;
  if (rule.minDiscountPct != null && (p.discountPct ?? 0) < rule.minDiscountPct) return false;
  if (rule.minPrice != null && p.price < Number(rule.minPrice)) return false;
  if (rule.maxPrice != null && p.price > Number(rule.maxPrice)) return false;
  return true;
}

export async function discoverForRule(rule: AutomationRule, deps: DiscoveryDeps = {}) {
  if (!rule.marketplaces.includes('SHOPEE')) return;
  const conn = await prisma.marketplaceConnection.findFirst({
    where: { tenantId: rule.tenantId, kind: 'SHOPEE' },
  });
  if (!conn?.encryptedCredentials) return;
  const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
  const search =
    deps.searchShopee ??
    ((c: ShopeeCredentials, keyword: string) =>
      createShopeeAdapter().search!(c, {
        source: 'SHOPEE',
        mode: 'keyword',
        query: keyword,
        sort: 'DISCOUNT_DESC',
        limit: 20,
        topSellers: false,
        extraCommission: false,
      }));

  const keyword = rule.keywords[Math.floor(Math.random() * rule.keywords.length)];
  if (!keyword) return;
  const results = await search(creds, keyword);
  const eligible = results.filter((p) => matchesFilters(p, rule));

  for (const p of eligible) {
    const product = await prisma.product.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId: rule.tenantId,
          source: p.source,
          externalId: p.externalId ?? '',
        },
      },
      update: {
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        discountPct: p.discountPct ?? null,
        images: p.images,
        shipping: p.shipping,
        raw: p.raw as object,
      },
      create: {
        tenantId: rule.tenantId,
        source: p.source,
        externalId: p.externalId ?? null,
        title: p.title,
        price: p.price,
        originalPrice: p.originalPrice ?? null,
        discountPct: p.discountPct ?? null,
        images: p.images,
        shipping: p.shipping,
        originalUrl: p.originalUrl,
        raw: p.raw as object,
      },
    });
    const already = await prisma.automationQueueItem.findFirst({
      where: { ruleId: rule.id, productId: product.id },
    });
    if (already) continue;
    await prisma.automationQueueItem.create({
      data: {
        tenantId: rule.tenantId,
        ruleId: rule.id,
        kind: 'PRODUCT',
        productId: product.id,
        manual: false,
      },
    });
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd apps/worker && npx vitest run test/automation-discovery.test.ts
```

Expected: PASS (2 testes).

- [ ] **Step 5: Ligar `AutomationScheduler` e `discoverForRule` em `apps/worker/src/main.ts`**

Adicionar os imports:

```typescript
import { AutomationScheduler } from './automation/scheduler';
import { discoverForRule } from './automation/discovery';
```

Após a linha `const mirrorListener = new MirrorListener(gateway);`, adicionar:

```typescript
const automationScheduler = new AutomationScheduler({ discover: (rule) => discoverForRule(rule) });
```

No handler do `redisSub.on('message', ...)`, adicionar o novo tipo de evento junto ao de mirror:

```typescript
if (ev.event?.type === 'automation.rules.changed') {
  void automationScheduler.reload();
}
```

Após `await mirrorListener.start();`, adicionar:

```typescript
await automationScheduler.start();
```

Na função `shutdown()`, no início do bloco `try`, adicionar `automationScheduler.stop();`.

- [ ] **Step 6: Rodar a suíte completa do worker**

```bash
cd apps/worker && npx vitest run
```

Expected: PASS em toda a suíte (nenhuma regressão em `mirror-listener`, `send-offer`, `automation-*` — `main.ts` não tem teste direto).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/automation apps/worker/src/main.ts apps/worker/test/automation-discovery.test.ts
git commit -m "feat(worker): descoberta Shopee real ligada ao AutomationScheduler via main.ts"
```

---

### Task 8: API — rotas de `AutomationRule` e fila

**Files:**
- Create: `apps/api/src/lib/automations.ts`
- Create: `apps/api/src/routes/automations.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/automations.test.ts`

**Interfaces:**
- Consome: `automationRuleCreateSchema`/`automationRuleUpdateSchema`/`automationQueueLinkSchema`/`automationQueueCouponSchema` (Task 2), `app.events.publish` (já existe), `parseProductUrl` (`@afilados/core`, já existe), `toApiProduct`/`upsertProducts` (`apps/api/src/lib/products.ts`, já existem), `loadShopeeCredentials`/`getShopeeAdapter` (`apps/api/src/lib/marketplaces.ts`, já existem), `getTagAdapter` (`@afilados/marketplaces`, já existe).
- Produz: rotas HTTP consumidas pela Task 9 (web).

- [ ] **Step 1: Escrever o teste de integração das rotas (falha primeiro)**

Criar `apps/api/test/automations.test.ts` seguindo exatamente o padrão de `apps/api/test/batches.test.ts` (mesmos helpers `createTenantWithUser`, `loginCookie`):

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let sessionId: string;
let templateId: string;

beforeAll(async () => {
  t = await createTenantWithUser();
  cookie = await loginCookie(app, t.email, t.password);
  const s = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 'c', status: 'CONNECTED' },
  });
  sessionId = s.id;
  await prisma.waGroup.create({
    data: { tenantId: t.tenantId, sessionId, jid: 'g1@g.us', name: 'G1' },
  });
  templateId = (await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } })).id;
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('automations routes', () => {
  let ruleId: string;

  it('cria uma regra', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/automations',
      headers: { cookie },
      payload: {
        name: 'Eletrônicos',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    expect(res.statusCode).toBe(201);
    ruleId = res.json().id;
    expect(res.json().enabled).toBe(false);
  });

  it('lista regras com estatísticas derivadas do log', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/automations', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rule = res.json().find((r: { id: string }) => r.id === ruleId);
    expect(rule.stats).toEqual({
      freshCount: 0,
      discoveredToday: 0,
      dispatchedToday: 0,
      lastDispatchedAt: null,
    });
  });

  it('liga a automação (toggle)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/${ruleId}/toggle`,
      headers: { cookie },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
  });

  it('rejeita grupo que não pertence à sessão', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/automations',
      headers: { cookie },
      payload: {
        name: 'x',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        sessionId,
        groupJids: ['inexistente@g.us'],
        templateId,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('adiciona cupom manual na fila com template próprio e lista como PENDING', async () => {
    const coupon = await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'AMAZON', code: 'PROMO10', description: '10% off' },
    });
    const couponTemplate = await prisma.template.create({
      data: { tenantId: t.tenantId, name: 'tc', body: '{codigo}', kind: 'COUPON' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/automations/${ruleId}/queue/coupon`,
      headers: { cookie },
      payload: { couponId: coupon.id, templateId: couponTemplate.id },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().templateId).toBe(couponTemplate.id);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const items = listRes.json();
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe('COUPON');
    expect(items[0].manual).toBe(true);
  });

  it('remove item da fila', async () => {
    const [item] = await prisma.automationQueueItem.findMany({ where: { ruleId } });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/automations/${ruleId}/queue/${item!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    const updated = await prisma.automationQueueItem.findUniqueOrThrow({ where: { id: item!.id } });
    expect(updated.status).toBe('REMOVED');
  });

  it('deleta a regra', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/automations/${ruleId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
cd apps/api && npx vitest run test/automations.test.ts
```

Expected: FAIL — rota `/api/v1/automations` retorna 404 (não registrada ainda).

- [ ] **Step 3: Implementar `apps/api/src/lib/automations.ts`**

```typescript
import type { TenantClient } from '@afilados/db';

export interface AutomationStats {
  freshCount: number;
  discoveredToday: number;
  dispatchedToday: number;
  lastDispatchedAt: string | null;
}

export async function getAutomationStats(db: TenantClient, ruleId: string): Promise<AutomationStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [freshCount, discoveredToday, dispatchedToday, lastDispatch] = await Promise.all([
    db.automationQueueItem.count({ where: { ruleId, status: 'PENDING' } }),
    db.automationLog.count({ where: { ruleId, action: 'DISCOVERED', createdAt: { gte: startOfDay } } }),
    db.automationLog.count({ where: { ruleId, action: 'DISPATCHED', createdAt: { gte: startOfDay } } }),
    db.automationLog.findFirst({ where: { ruleId, action: 'DISPATCHED' }, orderBy: { createdAt: 'desc' } }),
  ]);

  return {
    freshCount,
    discoveredToday,
    dispatchedToday,
    lastDispatchedAt: lastDispatch?.createdAt.toISOString() ?? null,
  };
}
```

- [ ] **Step 4: Implementar `apps/api/src/routes/automations.ts`**

Seguir exatamente o padrão de acesso a `req.db`/`req.tenantId` já usado em `apps/api/src/routes/batches.ts` (não há necessidade de type-casts manuais — usar `req.db.<model>` diretamente, como o resto do código já faz):

```typescript
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ApiError,
  automationRuleCreateSchema,
  automationRuleUpdateSchema,
  automationQueueLinkSchema,
  automationQueueCouponSchema,
} from '@afilados/shared';
import { parseProductUrl } from '@afilados/core';
import { getTagAdapter } from '@afilados/marketplaces';
import { requireAuth } from '../plugins/auth';
import { getAutomationStats } from '../lib/automations';
import { getShopeeAdapter, loadShopeeCredentials } from '../lib/marketplaces';
import { toApiProduct, upsertProducts } from '../lib/products';

const idParam = z.object({ id: z.string().min(1) });
const queueItemParam = z.object({ id: z.string().min(1), itemId: z.string().min(1) });
const toggleSchema = z.object({ enabled: z.boolean() });

async function assertRuleTargets(
  req: FastifyRequest,
  body: { sessionId: string; groupJids: string[]; templateId: string },
) {
  const session = await req.db.waSession.findFirst({ where: { id: body.sessionId } });
  if (!session) throw ApiError.notFound('Sessão não encontrada');
  const groups = await req.db.waGroup.findMany({
    where: { sessionId: session.id, jid: { in: body.groupJids } },
    select: { jid: true },
  });
  const known = new Set(groups.map((g) => g.jid));
  const unknown = body.groupJids.filter((j) => !known.has(j));
  if (unknown.length) throw ApiError.validation(`Grupos desconhecidos: ${unknown.join(', ')}`);
  const template = await req.db.template.findFirst({ where: { id: body.templateId } });
  if (!template) throw ApiError.notFound('Template não encontrado');
}

export async function automationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/automations', async (req) => {
    const rules = await req.db.automationRule.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(
      rules.map(async (r) => ({ ...r, stats: await getAutomationStats(req.db, r.id) })),
    );
  });

  app.post('/automations', async (req, reply) => {
    const body = automationRuleCreateSchema.parse(req.body);
    await assertRuleTargets(req, body);
    const rule = await req.db.automationRule.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: body,
    });
    return reply.status(201).send(rule);
  });

  app.patch('/automations/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = automationRuleUpdateSchema.parse(req.body);
    if (body.sessionId && body.groupJids && body.templateId) {
      await assertRuleTargets(req, body as { sessionId: string; groupJids: string[]; templateId: string });
    }
    return req.db.automationRule.update({ where: { id }, data: body });
  });

  app.post('/automations/:id/toggle', async (req) => {
    const { id } = idParam.parse(req.params);
    const { enabled } = toggleSchema.parse(req.body);
    const rule = await req.db.automationRule.update({ where: { id }, data: { enabled } });
    await app.events.publish(req.tenantId, { type: 'automation.rules.changed' });
    return rule;
  });

  app.delete('/automations/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const r = await req.db.automationRule.deleteMany({ where: { id } });
    if (r.count === 0) throw ApiError.notFound('Regra não encontrada');
    await app.events.publish(req.tenantId, { type: 'automation.rules.changed' });
    return reply.status(204).send();
  });

  app.get('/automations/:id/logs', async (req) => {
    const { id } = idParam.parse(req.params);
    return req.db.automationLog.findMany({
      where: { ruleId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/automations/:id/queue', async (req) => {
    const { id } = idParam.parse(req.params);
    const items = await req.db.automationQueueItem.findMany({
      where: { ruleId: id, status: 'PENDING' },
      orderBy: [{ manual: 'desc' }, { addedAt: 'asc' }],
      include: { product: true, coupon: true },
    });
    return items.map((i) => ({ ...i, product: i.product ? toApiProduct(i.product) : null }));
  });

  app.delete('/automations/:id/queue/:itemId', async (req, reply) => {
    const { itemId } = queueItemParam.parse(req.params);
    const r = await req.db.automationQueueItem.updateMany({
      where: { id: itemId },
      data: { status: 'REMOVED' },
    });
    if (r.count === 0) throw ApiError.notFound('Item não encontrado');
    return reply.status(204).send();
  });

  app.post('/automations/:id/queue/link', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { url } = automationQueueLinkSchema.parse(req.body);
    const parsed = parseProductUrl(url);
    if (parsed.source === 'UNSUPPORTED') throw ApiError.validation(parsed.reason);
    const rule = await req.db.automationRule.findFirst({ where: { id } });
    if (!rule) throw ApiError.notFound('Regra não encontrada');

    let found;
    if (parsed.source === 'SHOPEE') {
      const { creds } = await loadShopeeCredentials(req.db);
      [found] = await getShopeeAdapter().fetchByUrls(creds, [url]);
    } else {
      [found] = await getTagAdapter(parsed.source).fetchByUrls({}, [url]);
    }
    if (!found) throw new ApiError('MARKETPLACE_ERROR', 'Não foi possível resolver a URL', 502);
    const [product] = await upsertProducts(req.db, req.tenantId, [found]);

    const item = await req.db.automationQueueItem.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: { ruleId: id, kind: 'PRODUCT', productId: product!.id, manual: true },
    });
    await app.events.publish(req.tenantId, { type: 'automation.queue.updated', ruleId: id });
    return reply.status(201).send(item);
  });

  app.post('/automations/:id/queue/coupon', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = automationQueueCouponSchema.parse(req.body);
    const rule = await req.db.automationRule.findFirst({ where: { id } });
    if (!rule) throw ApiError.notFound('Regra não encontrada');

    let couponId = body.couponId;
    if (!couponId && body.coupon) {
      const coupon = await req.db.coupon.create({
        // @ts-expect-error tenantId é injetado pela extensão forTenant
        data: {
          store: body.coupon.store,
          code: body.coupon.code,
          description: body.coupon.description,
          expiresAt: body.coupon.expiresAt ? new Date(body.coupon.expiresAt) : null,
          sourceUrl: body.coupon.sourceUrl,
        },
      });
      couponId = coupon.id;
    }

    const item = await req.db.automationQueueItem.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: { ruleId: id, kind: 'COUPON', couponId, templateId: body.templateId, manual: true },
    });
    await app.events.publish(req.tenantId, { type: 'automation.queue.updated', ruleId: id });
    return reply.status(201).send(item);
  });
}
```

(O padrão `@ts-expect-error tenantId é injetado pela extensão forTenant` é copiado literalmente de `apps/api/src/routes/queue.ts` e `apps/api/src/routes/products.ts` — o `req.db` já é um client escopado por tenant que injeta `tenantId` automaticamente nas escritas, então o Prisma Client "puro" reclama do campo faltando no tipo, mas em runtime funciona.)

- [ ] **Step 5: Registrar a rota em `apps/api/src/app.ts`**

Adicionar o import:

```typescript
import { automationsRoutes } from './routes/automations';
```

E, junto aos outros `await api.register(...)`, adicionar:

```typescript
await api.register(automationsRoutes);
```

- [ ] **Step 6: Rodar o teste**

```bash
cd apps/api && npx vitest run test/automations.test.ts
```

Expected: PASS em todos os casos.

- [ ] **Step 7: Rodar a suíte completa da API**

```bash
cd apps/api && npx vitest run
```

Expected: PASS, sem regressão em `batches.test.ts`/`products.test.ts`. Se algum teste existente falhar por `BatchItem.product` agora poder ser `null` (por causa da Task 1), localizar o ponto exato apontado pelo erro do teste e ajustar a leitura para checar null antes de acessar campos do produto — não é esperado que isso aconteça em rotas que só leem `BatchItem` vindo de `Batch` criados por `POST /batches` (que sempre define `productId`), mas vale confirmar rodando a suíte.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src apps/api/test/automations.test.ts
git commit -m "feat(api): rotas de AutomationRule, fila e inserção manual (link/cupom)"
```

---

### Task 9: Web — tipos, queries e sidebar

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/queries.ts`
- Modify: `apps/web/src/components/app-shell/sidebar.tsx`

**Interfaces:**
- Consome: rotas da Task 8.
- Produz: `AutomationRule`, `AutomationQueueItem`, `useAutomationRules()`, `useAutomationQueue(ruleId)`, usados pela Task 10.

- [ ] **Step 1: Adicionar os tipos em `apps/web/src/lib/types.ts`**

```typescript
export interface AutomationStats {
  freshCount: number;
  discoveredToday: number;
  dispatchedToday: number;
  lastDispatchedAt: string | null;
}
export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  marketplaces: MarketplaceKind[];
  keywords: string[];
  blockedKeywords: string[];
  minDiscountPct: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  maxOffersPerDay: number;
  intervalMin: number;
  sessionId: string;
  groupJids: string[];
  templateId: string;
  mediaMode: MediaMode;
  createdAt: string;
  stats: AutomationStats;
}
export interface AutomationQueueItem {
  id: string;
  kind: 'PRODUCT' | 'COUPON';
  manual: boolean;
  status: 'PENDING' | 'DISPATCHED' | 'REMOVED';
  addedAt: string;
  product: ApiProduct | null;
  coupon: { id: string; store: string; code: string; description: string; expiresAt: string | null } | null;
}
```

- [ ] **Step 2: Adicionar os hooks de leitura em `apps/web/src/lib/queries.ts`**

Adicionar `AutomationRule, AutomationQueueItem` ao import de tipos no topo do arquivo, e adicionar:

```typescript
export const useAutomationRules = () =>
  useQuery({
    queryKey: ['automations'],
    queryFn: () => apiFetch<AutomationRule[]>('/automations'),
    refetchInterval: 15_000,
  });
export const useAutomationQueue = (ruleId: string | null) =>
  useQuery({
    queryKey: ['automations', ruleId, 'queue'],
    enabled: !!ruleId,
    queryFn: () => apiFetch<AutomationQueueItem[]>(`/automations/${ruleId}/queue`),
  });
```

- [ ] **Step 3: Adicionar a entrada de menu em `apps/web/src/components/app-shell/sidebar.tsx`**

Localizar o array de navegação e inserir, entre a entrada de `/produtos` e a de `/enviar`:

```typescript
{ href: '/automacoes', label: 'Automações', icon: Zap },
```

Importar `Zap` de `lucide-react` junto aos outros ícones já importados no topo do arquivo.

- [ ] **Step 4: Rodar o type-check do web**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: sem erros novos (a página `/automacoes` ainda não existe — isso só vira erro de rota 404 em runtime, não em type-check, já que o link do sidebar é só uma string `href`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib apps/web/src/components/app-shell/sidebar.tsx
git commit -m "feat(web): tipos e queries de automação, entrada de menu Automações"
```

---

### Task 10: Web — página `/automacoes`

**Files:**
- Create: `apps/web/src/app/(app)/automacoes/page.tsx`
- Create: `apps/web/src/components/automations/rule-form.tsx`
- Create: `apps/web/src/components/automations/rule-card.tsx`
- Create: `apps/web/src/components/automations/queue-panel.tsx`

**Interfaces:**
- Consome: `useAutomationRules`, `useAutomationQueue` (Task 9), `useSessions`, `useGroups`, `useTemplates` (já existem em `queries.ts`), `Button` (`@/components/ui/button`), `apiFetch` (`@/lib/api`), `useApiMutation` (`@/lib/mutations`).
- Produz: a página navegável `/automacoes`.

- [ ] **Step 1: Criar `apps/web/src/components/automations/rule-form.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useSessions, useGroups, useTemplates } from '@/lib/queries';
import type { AutomationRule } from '@/lib/types';

const MARKETS: { key: string; label: string; enabled: boolean }[] = [
  { key: 'SHOPEE', label: 'Shopee', enabled: true },
  { key: 'MERCADOLIVRE', label: 'Mercado Livre', enabled: false },
  { key: 'AMAZON', label: 'Amazon', enabled: false },
  { key: 'MAGALU', label: 'Magalu', enabled: false },
];

export function RuleForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [blockedKeywords, setBlockedKeywords] = useState('');
  const [minDiscountPct, setMinDiscountPct] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [intervalMin, setIntervalMin] = useState(60);
  const [maxOffersPerDay, setMaxOffersPerDay] = useState(20);
  const [sessionId, setSessionId] = useState('');
  const [groupJids, setGroupJids] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState('');

  const { data: sessions } = useSessions();
  const { data: groups } = useGroups(sessionId || null);
  const { data: templates } = useTemplates();

  const create = useApiMutation(
    () =>
      apiFetch<AutomationRule>('/automations', {
        method: 'POST',
        json: {
          name,
          marketplaces: ['SHOPEE'],
          keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
          blockedKeywords: blockedKeywords.split(',').map((k) => k.trim()).filter(Boolean),
          minDiscountPct: minDiscountPct ? Number(minDiscountPct) : undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
          intervalMin,
          maxOffersPerDay,
          sessionId,
          groupJids,
          templateId,
        },
      }),
    { invalidate: [['automations']], success: 'Automação criada', onSuccess: onCreated },
  );

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Nome da automação (ex: Eletrônicos até R$300)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <div className="flex gap-2">
        {MARKETS.map((m) => (
          <span
            key={m.key}
            className={
              m.enabled
                ? 'rounded bg-orange-100 px-2 py-1 text-sm'
                : 'rounded bg-gray-100 px-2 py-1 text-sm text-gray-400'
            }
            title={m.enabled ? undefined : 'Em breve'}
          >
            {m.label}
          </span>
        ))}
      </div>
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Keywords obrigatórias (separadas por vírgula)"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        required
      />
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Keywords bloqueadas (opcional)"
        value={blockedKeywords}
        onChange={(e) => setBlockedKeywords(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          className="rounded border px-3 py-2"
          placeholder="Desconto mín. (%)"
          value={minDiscountPct}
          onChange={(e) => setMinDiscountPct(e.target.value)}
        />
        <input
          type="number"
          className="rounded border px-3 py-2"
          placeholder="Preço máx. (R$)"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Intervalo (min)
          <input
            type="number"
            className="w-full rounded border px-3 py-2"
            value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
            min={5}
          />
        </label>
        <label className="text-sm">
          Limite/dia
          <input
            type="number"
            className="w-full rounded border px-3 py-2"
            value={maxOffersPerDay}
            onChange={(e) => setMaxOffersPerDay(Number(e.target.value))}
            min={1}
          />
        </label>
      </div>
      <select
        className="w-full rounded border px-3 py-2"
        value={sessionId}
        onChange={(e) => setSessionId(e.target.value)}
        required
      >
        <option value="">Sessão WhatsApp…</option>
        {sessions?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        multiple
        className="w-full rounded border px-3 py-2"
        value={groupJids}
        onChange={(e) => setGroupJids(Array.from(e.target.selectedOptions).map((o) => o.value))}
        required
      >
        {groups?.map((g) => (
          <option key={g.jid} value={g.jid}>
            {g.name}
          </option>
        ))}
      </select>
      <select
        className="w-full rounded border px-3 py-2"
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        required
      >
        <option value="">Template…</option>
        {templates?.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={create.isPending}>
        Criar automação
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Criar `apps/web/src/components/automations/queue-panel.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useAutomationQueue } from '@/lib/queries';

export function QueuePanel({ ruleId }: { ruleId: string }) {
  const { data: items } = useAutomationQueue(ruleId);
  const [linkUrl, setLinkUrl] = useState('');

  const removeItem = useApiMutation(
    (itemId: string) => apiFetch(`/automations/${ruleId}/queue/${itemId}`, { method: 'DELETE' }),
    { invalidate: [['automations', ruleId, 'queue']], success: 'Item removido' },
  );
  const addLink = useApiMutation(
    () => apiFetch(`/automations/${ruleId}/queue/link`, { method: 'POST', json: { url: linkUrl } }),
    {
      invalidate: [['automations', ruleId, 'queue']],
      success: 'Link adicionado à fila',
      onSuccess: () => setLinkUrl(''),
    },
  );

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Programado para disparar</p>
      <ul className="space-y-1">
        {items?.map((it) => (
          <li key={it.id} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
            <span>
              {it.manual && <span className="mr-1 rounded bg-blue-100 px-1 text-xs">manual</span>}
              {it.kind === 'PRODUCT' ? it.product?.title : `Cupom ${it.coupon?.code}`}
            </span>
            <Button variant="ghost" size="sm" onClick={() => removeItem.mutate(it.id)}>
              Remover
            </Button>
          </li>
        ))}
        {items?.length === 0 && <li className="text-sm text-gray-400">Nada na fila ainda.</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addLink.mutate();
        }}
      >
        <input
          className="flex-1 rounded border px-2 py-1 text-sm"
          placeholder="Colar link de produto…"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!linkUrl || addLink.isPending}>
          Adicionar link
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Criar `apps/web/src/components/automations/rule-card.tsx`**

```tsx
'use client';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { AutomationRule } from '@/lib/types';
import { QueuePanel } from './queue-panel';

export function RuleCard({ rule }: { rule: AutomationRule }) {
  const toggle = useApiMutation(
    (enabled: boolean) => apiFetch(`/automations/${rule.id}/toggle`, { method: 'POST', json: { enabled } }),
    { invalidate: [['automations']] },
  );

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{rule.name}</p>
          <p className="text-xs text-gray-500">
            {rule.keywords.join(', ')} · a cada {rule.intervalMin}min · limite {rule.maxOffersPerDay}/dia
          </p>
        </div>
        <Button variant={rule.enabled ? 'default' : 'outline'} size="sm" onClick={() => toggle.mutate(!rule.enabled)}>
          {rule.enabled ? 'Ligada' : 'Desligada'}
        </Button>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-gray-500">
        <span>Frescos p/ enviar: {rule.stats.freshCount}</span>
        <span>Buscados hoje: {rule.stats.discoveredToday}</span>
        <span>
          Último disparo:{' '}
          {rule.stats.lastDispatchedAt ? new Date(rule.stats.lastDispatchedAt).toLocaleString('pt-BR') : 'Nunca'}
        </span>
      </div>
      <QueuePanel ruleId={rule.id} />
    </div>
  );
}
```

- [ ] **Step 4: Criar `apps/web/src/app/(app)/automacoes/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { RuleForm } from '@/components/automations/rule-form';
import { RuleCard } from '@/components/automations/rule-card';
import { useAutomationRules } from '@/lib/queries';

export default function AutomacoesPage() {
  const { data: rules } = useAutomationRules();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Automações</h1>
        <button className="text-sm text-orange-600" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancelar' : '+ Nova automação'}
        </button>
      </div>
      {showForm && <RuleForm onCreated={() => setShowForm(false)} />}
      <div className="space-y-3">
        {rules?.map((r) => (
          <RuleCard key={r.id} rule={r} />
        ))}
        {rules?.length === 0 && !showForm && (
          <p className="text-sm text-gray-400">Nenhuma automação criada ainda.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rodar o type-check e o lint do web**

```bash
cd apps/web && npx tsc --noEmit
cd apps/web && npx eslint "src/app/(app)/automacoes/**" "src/components/automations/**"
```

Expected: sem erros.

- [ ] **Step 6: Subir o ambiente localmente e testar manualmente o fluxo golden-path**

```bash
docker compose up -d --build
```

No navegador: acessar `/automacoes`, criar uma automação com Shopee já configurado, colar um link de produto na fila manual, ligar a automação, e confirmar que a mensagem chega no grupo dentro de `intervalMin`. Testar também remover um item da fila antes dele disparar (deve sumir da lista e nunca ser enviado) e adicionar um cupom manual via `POST /automations/:id/queue/coupon` (a UI de cupom não está nesta primeira versão da página — usar `curl`/Postman com o endpoint diretamente para validar o caminho de ponta a ponta; a UI de cupom é um follow-up rápido de tela, não bloqueia o motor).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(app)/automacoes" apps/web/src/components/automations
git commit -m "feat(web): página /automacoes com regras, fila visível e inserção manual de link"
```

---

## Fora deste plano (próximos planos)

- **Plano 2/3**: `discoverByKeyword` para Mercado Livre, Amazon e Magalu (scraping de página de busca) — hoje esses marketplaces só entram na automação via inserção manual de link.
- **Plano 3/3**: integração Awin (conexão, `awin-feed-sync`, `AWIN` como `MarketplaceKind`/`ProductSource`).
- Aba "Cupom" no formulário de inserção manual da UI (`queue-panel.tsx`) — o backend (Task 8) já suporta `POST /automations/:id/queue/coupon` de ponta a ponta; falta só o formulário na UI, um follow-up pequeno e isolado.
- Seletor "Tipo: Produto/Cupom" na tela `/config/templates` — hoje `Template.kind` só pode ser setado via API; a tela de criação de template ainda não expõe o seletor.
