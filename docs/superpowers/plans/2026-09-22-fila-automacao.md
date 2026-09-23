# Gerenciamento da fila de automação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar o marketplace de cada item na fila de automação, permitir reordená-la por
arrastar-e-soltar (a ordem manda no disparo), e permitir que a extensão Afilados Connect envie
um link direto para a fila de uma automação escolhida.

**Architecture:** Uma coluna `position Int @default(autoincrement())` em `AutomationQueueItem`
vira a fonte única de ordem — novos itens (manual, cupom, descoberta automática, extensão) já
nascem no fim da fila sem nenhum código extra, e reordenar é só regravar essa coluna. A API
ganha uma rota `PATCH .../queue/order` e devolve `marketplace` computado em cada item; o worker
troca a busca de candidato de `addedAt`/grupo-manual-primeiro para `position asc` único; o painel
web ganha drag-and-drop nativo (sem dependência nova); a extensão ganha um seletor de destino.

**Tech Stack:** Fastify + Zod (API), Prisma + Postgres (dados), BullMQ/Node (worker), Next.js +
React 19 + TanStack Query (painel web), extensão Chrome MV3 vanilla JS (popup).

## Global Constraints

- Sem dependências novas — reordenação usa atributos HTML5 nativos (`draggable`), não
  `@dnd-kit` nem similar (spec §2, decisão confirmada com o usuário).
- `position` é `NOT NULL`, com backfill determinístico preservando a ordem atual
  (manual-primeiro, depois `addedAt`) — spec §2/"Migração e compatibilidade".
- A ordem da lista manda no disparo para manual E automático — sem mais "manual sempre na
  frente" (spec §2, decisão confirmada com o usuário).
- Toda rota nova segue os padrões já existentes no arquivo que edita: `ApiError.notFound`/
  `ApiError.validation`, `req.db` (tenant-scoped) nas rotas atrás de `requireAuth`,
  `authenticateExtension` + `forTenant(tenantId)` nas rotas de `/extension/*`.
- Migrações Prisma seguem o padrão de arquivo `packages/db/prisma/migrations/<timestamp>_<nome>/migration.sql` já usado no repo (ver `20260917193532_automation_core_engine`).

## Nota sobre testes pré-existentes falhando

Dois testes em `apps/worker/test/automation-scheduler.test.ts` já falham **antes** de qualquer
mudança deste plano:
- `despacha item manual antes de descobrir automaticamente` (`expected 2 to be 1` em
  `ruleCount()`)
- `pula produto inelegível (pendingEnrich) e loga SKIPPED sem despachar` (`expected 1 to be +0`
  em `enqueued.length`)

Causa raiz (não é escopo deste plano corrigir): `AutomationScheduler.reload()` faz
`prisma.automationRule.findMany({ where: { enabled: true } })` **sem filtrar por tenant**, e o
banco de teste (`localhost:5434/afilados`, ver `apps/worker/vitest.config.ts`) é o **mesmo**
banco de desenvolvimento — que tem uma regra real "Ofertas" com `enabled: true`. O scheduler de
teste carrega essa regra real junto com a regra do teste, e ela contamina os testes (dispara
descoberta/enfileiramento reais). Confirmado com `git stash` antes de qualquer mudança de hoje —
já falhava na branch `main` original.

**Ação:** nenhuma. Cada task que roda essa suíte deve conferir que o número de falhas continua
exatamente 2 (mesmos dois testes, mesma mensagem) — se aparecer uma falha nova ou diferente, é
regressão real e precisa ser investigada antes de prosseguir.

---

## Task 1: Coluna `position` em AutomationQueueItem

**Files:**
- Modify: `packages/db/prisma/schema.prisma:561-581` (model `AutomationQueueItem`)
- Create: `packages/db/prisma/migrations/20260922210000_automation_queue_position/migration.sql`
- Modify: `packages/db/test/automation-schema.test.ts`

**Interfaces:**
- Produces: campo `position: number` em todo `AutomationQueueItem` (via Prisma Client
  regenerado), preenchido automaticamente em `create()` por `@default(autoincrement())` — nenhum
  outro arquivo precisa passar `position` explicitamente.

- [ ] **Step 1: Editar o schema Prisma**

Em `packages/db/prisma/schema.prisma`, no model `AutomationQueueItem`, adicione o campo
`position` logo antes de `addedAt` e troque o índice existente:

```prisma
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
  // Só usado quando kind = COUPON: o template de cupom escolhido na inserção manual
  templateId   String?
  template     Template?              @relation("QueueItemCouponTemplate", fields: [templateId], references: [id])
  manual       Boolean                @default(false)
  status       AutomationQueueStatus  @default(PENDING)
  // Ordem de disparo dentro da regra — menor primeiro. Autoincrementa sozinho em cada create(),
  // então um item novo (manual, cupom, descoberta automática ou extensão) sempre nasce no fim
  // da fila sem nenhum código precisar calcular "próxima posição". Reordenar é só regravar este
  // campo (ver PATCH /automations/:id/queue/order).
  position     Int                    @default(autoincrement())
  addedAt      DateTime               @default(now())
  dispatchedAt DateTime?

  @@index([tenantId, ruleId, status, position])
}
```

(Note que `@@index([tenantId, ruleId, status, addedAt])` foi removido — a ordenação por
`addedAt` para esta tabela deixa de existir; `addedAt` continua na tabela como metadado, só não
é mais usado como critério de ordenação.)

- [ ] **Step 2: Escrever a migration à mão**

Crie o diretório e o arquivo:

```bash
mkdir -p "packages/db/prisma/migrations/20260922210000_automation_queue_position"
```

Conteúdo de
`packages/db/prisma/migrations/20260922210000_automation_queue_position/migration.sql`:

```sql
-- AlterTable: adiciona a coluna ainda opcional para poder popular na ordem certa antes de travar NOT NULL
ALTER TABLE "AutomationQueueItem" ADD COLUMN "position" INTEGER;

-- Backfill: preserva a ordem de disparo atual (manual primeiro, depois por addedAt) por regra
UPDATE "AutomationQueueItem" AS t
SET "position" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "ruleId"
    ORDER BY manual DESC, "addedAt" ASC
  ) - 1 AS rn
  FROM "AutomationQueueItem"
) AS sub
WHERE t.id = sub.id;

-- Agora que toda linha tem posição, trava NOT NULL
ALTER TABLE "AutomationQueueItem" ALTER COLUMN "position" SET NOT NULL;

-- Cria a sequência que vai gerar a posição de cada INSERT novo (equivalente a @default(autoincrement())),
-- começando depois do maior valor já usado no backfill para não colidir com os itens existentes
CREATE SEQUENCE "AutomationQueueItem_position_seq" OWNED BY "AutomationQueueItem"."position";
SELECT setval(
  '"AutomationQueueItem_position_seq"',
  COALESCE((SELECT MAX(position) FROM "AutomationQueueItem"), 0) + 1,
  false
);
ALTER TABLE "AutomationQueueItem" ALTER COLUMN "position" SET DEFAULT nextval('"AutomationQueueItem_position_seq"');

-- DropIndex: a ordenação por addedAt não é mais usada nesta tabela
DROP INDEX "AutomationQueueItem_tenantId_ruleId_status_addedAt_idx";

-- CreateIndex
CREATE INDEX "AutomationQueueItem_tenantId_ruleId_status_position_idx" ON "AutomationQueueItem"("tenantId", "ruleId", "status", "position");
```

- [ ] **Step 3: Aplicar a migration e regenerar o client**

```bash
pnpm --filter @afilados/db exec prisma migrate deploy
pnpm --filter @afilados/db run generate
```

Expected: ambos os comandos terminam sem erro; o segundo reimprime "Generated Prisma Client".

- [ ] **Step 4: Verificar o backfill manualmente**

```bash
docker exec afilados-postgres-1 psql -U afilados -d afilados -c \
  'SELECT id, "ruleId", manual, position FROM "AutomationQueueItem" ORDER BY "ruleId", position;'
```

Expected: para cada `ruleId`, as linhas com `manual = t` aparecem primeiro (mesma ordem que
tinham por `addedAt`), seguidas pelas `manual = f`, com `position` crescendo 0, 1, 2... sem
pular nem repetir número dentro da mesma regra.

- [ ] **Step 5: Atualizar o teste de schema para cobrir `position`**

Em `packages/db/test/automation-schema.test.ts`, depois do bloco que já cria `queueItem` e
`couponItem` (ao redor da linha 42-58), adicione:

```typescript
    expect(queueItem.position).toBeTypeOf('number');
    expect(couponItem.position).toBeGreaterThan(queueItem.position);
  });

  it('cada AutomationQueueItem novo nasce com position maior que o anterior da mesma regra', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'automation-position-test' } });
    const session = await prisma.waSession.create({ data: { tenantId: tenant.id, label: 's' } });
    const template = await prisma.template.create({
      data: { tenantId: tenant.id, name: 't', body: 'oi' },
    });
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: tenant.id,
        name: 'Regra Position',
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        source: 'SHOPEE',
        title: 'Fone Y',
        price: 50,
        images: ['https://x/y.png'],
        originalUrl: 'https://shopee.com.br/p/y',
        raw: {},
      },
    });
    const first = await prisma.automationQueueItem.create({
      data: { tenantId: tenant.id, ruleId: rule.id, kind: 'PRODUCT', productId: product.id },
    });
    const second = await prisma.automationQueueItem.create({
      data: { tenantId: tenant.id, ruleId: rule.id, kind: 'PRODUCT', productId: product.id },
    });
    expect(second.position).toBeGreaterThan(first.position);
  });
```

Cuidado: essa edição substitui o `});` que hoje fecha o primeiro `it(...)` do arquivo — copie o
bloco inteiro incluindo o `});` extra mostrado acima, não apenas as linhas de `expect` novas.

- [ ] **Step 6: Rodar os testes do pacote db**

```bash
cd packages/db && npx vitest run test/automation-schema.test.ts
```

Expected: todos os testes do arquivo passam, incluindo os 2 novos.

- [ ] **Step 7: Commit**

```bash
cd /d/apps/afilados
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/test/automation-schema.test.ts
git commit -m "feat(db): coluna position em AutomationQueueItem com backfill e autoincrement

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: API — marketplace na fila e reordenação

**Files:**
- Modify: `packages/shared/src/automation.ts`
- Modify: `apps/api/src/routes/automations.ts:125-133` (rota `GET .../queue`), adicionar rota
  `PATCH .../queue/order` logo após ela
- Modify: `apps/api/test/automations.test.ts`

**Interfaces:**
- Consumes: `ApiError.notFound`/`ApiError.validation` de `@afilados/shared` (já importados no
  arquivo); `req.db: TenantClient` (já disponível via `requireAuth`, ver
  `apps/api/src/plugins/auth.ts:33`); `toApiProduct` de `../lib/products` (já importado).
- Produces: `automationQueueOrderSchema` (novo, em `packages/shared/src/automation.ts`) e tipo
  `AutomationQueueOrderBody`, consumidos pela rota `PATCH .../queue/order`. `GET .../queue`
  passa a devolver cada item com um campo adicional `marketplace: string | null`.

- [ ] **Step 1: Adicionar o schema de reordenação em shared**

Em `packages/shared/src/automation.ts`, logo depois de `automationQueueCouponSchema`/seu
`export type`, adicione:

```typescript
export const automationQueueOrderSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
});
export type AutomationQueueOrderBody = z.infer<typeof automationQueueOrderSchema>;
```

- [ ] **Step 2: Escrever o teste de reordenação (falhando)**

Em `apps/api/test/automations.test.ts`, logo antes do `it('remove item da fila', ...)` (perto do
fim do arquivo, ver linha ~198), adicione:

```typescript
  it('reordena a fila via PATCH /queue/order e o GET reflete a nova ordem', async () => {
    const items = await prisma.automationQueueItem.findMany({
      where: { ruleId, status: 'PENDING' },
      orderBy: { position: 'asc' },
    });
    expect(items.length).toBeGreaterThanOrEqual(2);
    const reversedIds = items.map((i) => i.id).reverse();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}/queue/order`,
      headers: { cookie },
      payload: { itemIds: reversedIds },
    });
    expect(res.statusCode).toBe(204);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const ordered = listRes.json();
    expect(ordered.map((i: { id: string }) => i.id)).toEqual(reversedIds);
  });

  it('GET /queue devolve o marketplace de cada item', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/automations/${ruleId}/queue`,
      headers: { cookie },
    });
    const items = listRes.json();
    for (const item of items) {
      if (item.kind === 'PRODUCT') expect(item.marketplace).toBe(item.product.source);
      if (item.kind === 'COUPON') expect(item.marketplace).toBe(item.coupon.store);
    }
  });

  it('rejeita PATCH /queue/order com item de outra regra → 400', async () => {
    const otherRule = await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'outra-regra-order',
        marketplaces: ['SHOPEE'],
        keywords: ['x'],
        blockedKeywords: [],
        sessionId,
        groupJids: ['g1@g.us'],
        templateId,
      },
    });
    const otherCoupon = await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'AMAZON', code: 'OUTRAREGRA', description: 'x' },
    });
    const foreignItem = await prisma.automationQueueItem.create({
      data: { tenantId: t.tenantId, ruleId: otherRule.id, kind: 'COUPON', couponId: otherCoupon.id, templateId, manual: true },
    });
    const own = await prisma.automationQueueItem.findFirst({ where: { ruleId, status: 'PENDING' } });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}/queue/order`,
      headers: { cookie },
      payload: { itemIds: [foreignItem.id, own!.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejeita PATCH /queue/order que não cobre todos os itens pendentes da regra → 400', async () => {
    const own = await prisma.automationQueueItem.findMany({ where: { ruleId, status: 'PENDING' } });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/automations/${ruleId}/queue/order`,
      headers: { cookie },
      payload: { itemIds: [own[0]!.id] },
    });
    expect(res.statusCode).toBe(400);
  });

```

- [ ] **Step 3: Rodar os testes e confirmar que falham por rota inexistente**

```bash
cd apps/api && npx vitest run test/automations.test.ts 2>&1 | tail -40
```

Expected: as 4 novas asserções falham (a rota `PATCH .../queue/order` ainda não existe → 404 em
vez de 204/400, e `marketplace` ainda não existe no JSON).

- [ ] **Step 4: Implementar `marketplace` no `GET .../queue`**

Em `apps/api/src/routes/automations.ts`, substitua o handler `GET /automations/:id/queue`
(linhas 125-133) por:

```typescript
  app.get('/automations/:id/queue', async (req) => {
    const { id } = idParam.parse(req.params);
    const items = await req.db.automationQueueItem.findMany({
      where: { ruleId: id, status: 'PENDING' },
      orderBy: { position: 'asc' },
      include: { product: true, coupon: true },
    });
    return items.map((i) => ({
      ...i,
      product: i.product ? toApiProduct(i.product) : null,
      marketplace: i.kind === 'PRODUCT' ? (i.product?.source ?? null) : (i.coupon?.store ?? null),
    }));
  });
```

- [ ] **Step 5: Implementar `PATCH /automations/:id/queue/order`**

No mesmo arquivo, logo depois do handler acima (antes de
`app.delete('/automations/:id/queue/:itemId', ...)`), adicione:

```typescript
  app.patch('/automations/:id/queue/order', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { itemIds } = automationQueueOrderSchema.parse(req.body);
    const rule = await req.db.automationRule.findFirst({ where: { id } });
    if (!rule) throw ApiError.notFound('Regra não encontrada');

    const pending = await req.db.automationQueueItem.findMany({
      where: { ruleId: id, status: 'PENDING' },
      select: { id: true },
    });
    const pendingIds = new Set(pending.map((p) => p.id));
    const receivedIds = new Set(itemIds);
    const sameSet =
      pendingIds.size === receivedIds.size &&
      pendingIds.size === itemIds.length &&
      itemIds.every((itemId) => pendingIds.has(itemId));
    if (!sameSet) {
      throw ApiError.validation(
        'A lista precisa conter exatamente os itens pendentes da regra, sem repetição',
      );
    }

    await req.db.$transaction(
      itemIds.map((itemId, index) =>
        req.db.automationQueueItem.updateMany({
          where: { id: itemId, ruleId: id },
          data: { position: index },
        }),
      ),
    );

    await app.events.publish(req.tenantId, { type: 'automation.queue.updated', ruleId: id });
    return reply.status(204).send();
  });
```

- [ ] **Step 6: Importar `automationQueueOrderSchema`**

No topo de `apps/api/src/routes/automations.ts`, no bloco de import de `@afilados/shared`
(linhas 3-8), adicione `automationQueueOrderSchema` à lista:

```typescript
import {
  ApiError,
  automationRuleCreateSchema,
  automationRuleUpdateSchema,
  automationQueueLinkSchema,
  automationQueueCouponSchema,
  automationQueueOrderSchema,
} from '@afilados/shared';
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

```bash
cd apps/api && npx vitest run test/automations.test.ts
```

Expected: todos os testes do arquivo passam, incluindo os 4 novos.

- [ ] **Step 8: Typecheck**

```bash
cd /d/apps/afilados
pnpm --filter @afilados/shared typecheck
pnpm --filter @afilados/api typecheck
```

Expected: sem erros novos.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/automation.ts apps/api/src/routes/automations.ts apps/api/test/automations.test.ts
git commit -m "feat(api): marketplace visível na fila e PATCH /queue/order para reordenar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Worker — disparo segue a ordem da fila (`position`)

**Files:**
- Modify: `apps/worker/src/automation/scheduler.ts:126-152` (método `dispatchNext`)
- Modify: `apps/worker/test/automation-scheduler.test.ts`

**Interfaces:**
- Consumes: `prisma.automationQueueItem` (campo `position`, produzido na Task 1).
- Produces: nenhuma interface nova — só muda o critério de escolha do próximo candidato dentro
  de `AutomationScheduler.dispatchNext`, já privado/interno.

- [ ] **Step 1: Escrever o teste de ordenação por `position` (falhando)**

Em `apps/worker/test/automation-scheduler.test.ts`, depois do terceiro teste (`'pula item
manual inelegível e despacha o próximo elegível na mesma rodada'`, termina perto da linha 185),
adicione um novo teste no mesmo `describe('AutomationScheduler', ...)`:

```typescript
  it('despacha pela ordem de position, não por manual nem por addedAt', async () => {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId,
        name: 'r-position',
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
        title: 'Fone Automático',
        price: 40,
        images: ['https://x/auto.png'],
        originalUrl: 'https://shopee.com.br/p/auto',
        raw: {},
      },
    });
    // Item AUTOMÁTICO criado primeiro (position menor por padrão)
    const autoItem = await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: false },
    });
    // Item MANUAL criado depois (position maior por padrão) — no comportamento antigo,
    // manual sempre venceria; agora precisa perder porque tem position maior.
    const manualItem = await prisma.automationQueueItem.create({
      data: { tenantId, ruleId: rule.id, kind: 'PRODUCT', productId: product.id, manual: true },
    });
    expect(manualItem.position).toBeGreaterThan(autoItem.position);

    const enqueued: string[] = [];
    const scheduler = new AutomationScheduler({
      enqueue: async (_tenantId, batchItemId) => {
        enqueued.push(batchItemId);
      },
      discover: async () => {},
    });
    await scheduler.reload();
    await scheduler.tick();

    expect(enqueued.length).toBe(1);
    const dispatchedAuto = await prisma.automationQueueItem.findUniqueOrThrow({ where: { id: autoItem.id } });
    const stillPendingManual = await prisma.automationQueueItem.findUniqueOrThrow({ where: { id: manualItem.id } });
    expect(dispatchedAuto.status).toBe('DISPATCHED');
    expect(stillPendingManual.status).toBe('PENDING');
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que o novo falha**

```bash
cd apps/worker && npx vitest run test/automation-scheduler.test.ts 2>&1 | tail -50
```

Expected: o teste novo falha (o item manual é despachado primeiro, não o automático) — **e os 2
testes pré-existentes já descritos na seção "Nota sobre testes pré-existentes falhando" também
falham, exatamente como antes.** Se algum teste ALÉM desses 3 falhar, pare e investigue antes de
prosseguir.

- [ ] **Step 3: Reescrever `dispatchNext` para escolher por `position`**

Em `apps/worker/src/automation/scheduler.ts`, dentro do método `dispatchNext` (linhas 122-152
do arquivo atual), substitua o corpo do laço `for` desde `const manual = await
prisma.automationQueueItem.findFirst(...)` até o bloco `if (!candidate) { ... return; }`
(linhas 126-152) por:

```typescript
    for (let attempt = 0; attempt < MAX_DISPATCH_ATTEMPTS; attempt++) {
      // Gatilho da descoberta preservado do comportamento original: só dispara quando não há
      // NENHUM item manual pendente nesta rodada (mesmo que já existam itens automáticos na
      // fila) — no máximo uma vez por chamada de dispatchNext, via a flag `discovered`.
      if (!discovered) {
        const hasManualPending = await prisma.automationQueueItem.count({
          where: { ruleId: rule.id, manual: true, status: 'PENDING' },
        });
        if (hasManualPending === 0) {
          await this.discover(rule);
          discovered = true;
        }
      }

      // Escolha do candidato: sempre pela ordem da fila (position), manual ou automático —
      // é a ordem que o usuário vê e reorganiza no painel.
      const candidate = await prisma.automationQueueItem.findFirst({
        where: { ruleId: rule.id, status: 'PENDING' },
        orderBy: { position: 'asc' },
        include: { product: true, coupon: true },
      });

      if (!candidate) {
        await prisma.automationLog.create({
          data: {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            marketplace: rule.marketplaces[0] ?? 'SHOPEE',
            action: 'SKIPPED',
            reason: 'nenhum produto elegível encontrado',
          },
        });
        return;
      }
```

Note que o `let discovered = false;` que já existe logo antes do `for` (linha ~123) continua
igual — não mexa nele. O resto do método (a partir de `const productMarketplace = ...`) fica
inalterado.

- [ ] **Step 4: Rodar os testes e confirmar o resultado esperado**

```bash
cd apps/worker && npx vitest run test/automation-scheduler.test.ts 2>&1 | tail -50
```

Expected: o novo teste (`'despacha pela ordem de position...'`) passa; os outros testes que já
passavam continuam passando; os mesmos 2 testes pré-existentes da seção "Nota sobre testes
pré-existentes falhando" continuam falhando com a mesma mensagem — nenhuma falha nova.

- [ ] **Step 5: Typecheck**

```bash
cd /d/apps/afilados && pnpm --filter @afilados/worker typecheck
```

Expected: sem erros novos (os erros pré-existentes de `exactOptionalPropertyTypes` no
AliExpress adapter, se ainda presentes, não são deste plano).

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/automation/scheduler.ts apps/worker/test/automation-scheduler.test.ts
git commit -m "feat(worker): disparo da automação segue a ordem da fila (position), não mais manual-primeiro

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Painel — badge de marketplace e reordenar por arrastar-e-soltar

**Files:**
- Modify: `apps/web/src/lib/types.ts` (interface `AutomationQueueItem`)
- Modify: `apps/web/src/components/automations/queue-panel.tsx`

**Interfaces:**
- Consumes: `GET /automations/:id/queue` agora devolve `marketplace: string | null` em cada
  item (Task 2); `PATCH /automations/:id/queue/order` com body `{ itemIds: string[] }` (Task
  2); `apiFetch` de `@/lib/api`; `useApiMutation` de `@/lib/mutations`; `useAutomationQueue` de
  `@/lib/queries` (nenhuma mudança necessária nesse hook — já busca a lista completa).
- Produces: nenhuma interface nova consumida por outro componente — `QueuePanel` continua sendo
  usado do mesmo jeito por quem já o renderiza.

- [ ] **Step 1: Adicionar `marketplace` ao tipo `AutomationQueueItem`**

Em `apps/web/src/lib/types.ts`, na interface `AutomationQueueItem` (linha ~256), adicione o
campo:

```typescript
export interface AutomationQueueItem {
  id: string;
  kind: 'PRODUCT' | 'COUPON';
  manual: boolean;
  status: 'PENDING' | 'DISPATCHED' | 'REMOVED';
  addedAt: string;
  marketplace: string | null;
  product: ApiProduct | null;
  coupon: { id: string; store: string; code: string; description: string; expiresAt: string | null; sourceUrl: string | null } | null;
}
```

- [ ] **Step 2: Reescrever `queue-panel.tsx` com badge de marketplace e drag-and-drop**

Substitua o conteúdo inteiro de `apps/web/src/components/automations/queue-panel.tsx` por:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, ApiClientError } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useAutomationQueue } from '@/lib/queries';
import type { AutomationQueueItem } from '@/lib/types';
import { cn } from '@/lib/utils';

const MARKETPLACE_LABELS: Record<string, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  AWIN: 'Awin',
  ALIEXPRESS: 'AliExpress',
  MANUAL: 'Manual',
};

function marketplaceLabel(marketplace: string | null): string {
  if (!marketplace) return '—';
  return MARKETPLACE_LABELS[marketplace] ?? marketplace;
}

export function QueuePanel({ ruleId }: { ruleId: string }) {
  const { data: items } = useAutomationQueue(ruleId);
  const [linkUrl, setLinkUrl] = useState('');
  const [order, setOrder] = useState<AutomationQueueItem[]>([]);
  const dragIndexRef = useRef<number | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (items) setOrder(items);
  }, [items]);

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

  // Reordenação tem UI otimista (a lista já muda visualmente ao soltar) — em caso de erro,
  // reverte para a última lista confirmada pelo servidor (`items`) em vez de deixar a UI
  // divergente do banco. useApiMutation não dá esse gancho de rollback, então usa useMutation
  // direto aqui, mantendo o mesmo toast de erro que useApiMutation usaria.
  const reorder = useMutation({
    mutationFn: (itemIds: string[]) =>
      apiFetch(`/automations/${ruleId}/queue/order`, { method: 'PATCH', json: { itemIds } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['automations', ruleId, 'queue'] });
    },
    onError: (err) => {
      setOrder(items ?? []);
      toast.error(err instanceof ApiClientError ? err.message : 'Erro ao reordenar a fila');
    },
  });

  function handleDrop(dropIndex: number) {
    const dragIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (dragIndex === null || dragIndex === dropIndex) return;
    const next = [...order];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved!);
    setOrder(next);
    reorder.mutate(next.map((i) => i.id));
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-sm font-medium">Programado para disparar</p>
      <ul className="space-y-1">
        {order.map((it, index) => (
          <li
            key={it.id}
            draggable
            onDragStart={() => {
              dragIndexRef.current = index;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(index)}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-2 py-1 text-sm"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <GripVertical
                className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
                aria-hidden
              />
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {marketplaceLabel(it.marketplace)}
              </Badge>
              {it.manual && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  manual
                </Badge>
              )}
              <span className="truncate">
                {it.kind === 'PRODUCT' ? it.product?.title : `Cupom ${it.coupon?.code}`}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => removeItem.mutate(it.id)}
            >
              Remover
            </Button>
          </li>
        ))}
        {order.length === 0 && (
          <li className="text-sm text-muted-foreground">Nada na fila ainda.</li>
        )}
      </ul>
      <form
        className={cn('flex gap-2')}
        onSubmit={(e) => {
          e.preventDefault();
          addLink.mutate();
        }}
      >
        <Input
          className="flex-1"
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

- [ ] **Step 3: Teste de componente do badge de marketplace**

O projeto já tem suíte de teste de componente configurada (`@testing-library/react`, ver
`apps/web/test/marketplaces-page.test.tsx` para o padrão de `QueryClientProvider` + mock de
`apiFetch`). Crie `apps/web/test/queue-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueuePanel } from '@/components/automations/queue-panel';
import type { AutomationQueueItem } from '@/lib/types';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn(), ApiClientError: class extends Error {} }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const items: AutomationQueueItem[] = [
  {
    id: 'q1',
    kind: 'PRODUCT',
    manual: false,
    status: 'PENDING',
    addedAt: '2026-09-22T00:00:00.000Z',
    marketplace: 'SHOPEE',
    product: {
      id: 'p1',
      source: 'SHOPEE',
      externalId: '1',
      title: 'Fone Bluetooth',
      price: 50,
      originalPrice: null,
      discountPct: null,
      salesCount: null,
      commissionPct: null,
      images: [],
      shipping: 'UNKNOWN',
      flashSaleEndsAt: null,
      couponCode: null,
      originalUrl: 'https://shopee.com.br/p/1',
      shopId: null,
      shopName: null,
    },
    coupon: null,
  },
  {
    id: 'q2',
    kind: 'COUPON',
    manual: true,
    status: 'PENDING',
    addedAt: '2026-09-22T00:01:00.000Z',
    marketplace: 'AMAZON',
    product: null,
    coupon: { id: 'c1', store: 'AMAZON', code: 'PROMO10', description: '10% off', expiresAt: null, sourceUrl: null },
  },
];

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QueuePanel ruleId="rule-1" />
    </QueryClientProvider>,
  );
}

describe('QueuePanel', () => {
  it('mostra o badge do marketplace de cada item, incluindo cupons', async () => {
    apiFetchMock.mockResolvedValue(items);
    renderPanel();
    expect(await screen.findByText('Fone Bluetooth')).toBeInTheDocument();
    expect(screen.getByText('Shopee')).toBeInTheDocument();
    expect(screen.getByText('Amazon')).toBeInTheDocument();
    expect(screen.getByText('Cupom PROMO10')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
  });
});
```

Rode:

```bash
cd apps/web && npx vitest run test/queue-panel.test.tsx
```

Expected: passa, mostrando os badges "Shopee" e "Amazon" e o texto "Cupom PROMO10".

- [ ] **Step 4: Typecheck e lint**

```bash
cd /d/apps/afilados
pnpm --filter @afilados/web typecheck
```

Expected: sem erros novos.

- [ ] **Step 5: Verificação manual no navegador**

```bash
docker compose build web api && docker compose up -d web api worker
```

Abra o painel, entre numa automação com 2+ itens na fila, confirme visualmente: (a) cada item
mostra o badge do marketplace; (b) arrastar um item para outra posição atualiza a lista na hora;
(c) recarregar a página mantém a nova ordem (persistiu no banco).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/components/automations/queue-panel.tsx apps/web/test/queue-panel.test.tsx
git commit -m "feat(web): badge de marketplace e reordenar a fila da automação por arrastar-e-soltar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: API — extensão envia link para a fila de uma automação

**Files:**
- Modify: `packages/shared/src/api.ts:177-190` (`extensionCaptureSchema`)
- Modify: `apps/api/src/routes/extension.ts`
- Modify: `apps/api/test/extension-and-tokens.test.ts`

**Interfaces:**
- Consumes: `forTenant(tenantId)` de `@afilados/db` (já importado em `extension.ts`);
  `upsertProducts`/`toApiProduct` de `../lib/products` (já importados); `ApiError` de
  `@afilados/shared` (já importado).
- Produces: rota `GET /extension/automations` → `{ id: string; name: string; keywords:
  string[]; marketplaces: string[] }[]`; `POST /extension/capture` aceita `automationRuleId?:
  string` no body.

- [ ] **Step 1: Adicionar `automationRuleId` opcional ao schema de captura**

Em `packages/shared/src/api.ts`, dentro de `extensionCaptureSchema` (linhas 177-190),
adicione o campo antes do `});` final:

```typescript
export const extensionCaptureSchema = z.object({
  url: z.string().url(),
  marketplaceKind: z.enum(MARKETPLACE_KINDS),
  title: z.string().min(1).max(500).nullish(),
  price: z.number().positive().nullish(),
  originalPrice: z.number().positive().nullish(),
  discountPct: z.number().int().min(1).max(100).nullish(),
  images: z.array(z.string().url()).nullish(),
  couponCode: z.string().max(60).nullish(),
  couponValue: z.number().positive().nullish(),
  shipping: z.enum(['NONE', 'FREE', 'FULL', 'UNKNOWN']).nullish(),
  flashSaleEndsAt: z.string().datetime().nullish(),
  affiliateUrl: z.string().url().nullish(),
  // Quando presente, o produto capturado vai direto para a fila desta automação (item manual)
  // em vez de cair na Fila de Triagem.
  automationRuleId: z.string().min(1).nullish(),
});
```

- [ ] **Step 2: Escrever o teste de captura direcionada a uma automação (falhando)**

Em `apps/api/test/extension-and-tokens.test.ts`, depois do teste `'captura produto diretamente
via extensão com metadados e coloca na fila de triagem'` (a mesma seção `it(...)` — veja em
volta da linha 79-... até o `});` que fecha esse `it`), adicione um novo `it` no mesmo
`describe`:

```typescript
  it('lista automações ativas do tenant em GET /extension/automations', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Automacoes' },
    });
    const { token } = tokenRes.json();

    const session = await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 's' } });
    const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    const enabledRule = await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'Ativa',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });
    await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'Desligada',
        enabled: false,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/extension/automations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.map((r: { id: string }) => r.id)).toContain(enabledRule.id);
    expect(list.map((r: { name: string }) => r.name)).not.toContain('Desligada');
  });

  it('captura com automationRuleId cria item na fila da automação, não na fila de triagem', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Automacao Captura' },
    });
    const { token } = tokenRes.json();

    const session = await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 's2' } });
    const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: t.tenantId,
        name: 'Destino',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: session.id,
        groupJids: ['g@g.us'],
        templateId: template.id,
      },
    });

    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/capture',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: 'https://shopee.com.br/produto-x-i.111.222',
        marketplaceKind: 'SHOPEE',
        title: 'Produto Capturado Para Automação',
        price: 39.9,
        automationRuleId: rule.id,
      },
    });
    expect(captureRes.statusCode).toBe(200);

    const queueItems = await prisma.automationQueueItem.findMany({ where: { ruleId: rule.id } });
    expect(queueItems.length).toBe(1);
    expect(queueItems[0]!.manual).toBe(true);
    expect(queueItems[0]!.status).toBe('PENDING');

    // Não deve ter ido para a Fila de Triagem
    const triageItems = await prisma.queueItem.findMany({
      where: { tenantId: t.tenantId, product: { title: 'Produto Capturado Para Automação' } },
    });
    expect(triageItems.length).toBe(0);
  });

  it('rejeita automationRuleId de outro tenant na captura → 404', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-tokens',
      headers: { cookie },
      payload: { name: 'Token Automacao Foreign' },
    });
    const { token } = tokenRes.json();

    const other = await createTenantWithUser('extensao-outro-tenant');
    const otherSession = await prisma.waSession.create({ data: { tenantId: other.tenantId, label: 's3' } });
    const otherTemplate = await prisma.template.findFirstOrThrow({ where: { tenantId: other.tenantId } });
    const foreignRule = await prisma.automationRule.create({
      data: {
        tenantId: other.tenantId,
        name: 'De outro tenant',
        enabled: true,
        marketplaces: ['SHOPEE'],
        keywords: ['fone'],
        blockedKeywords: [],
        sessionId: otherSession.id,
        groupJids: ['g@g.us'],
        templateId: otherTemplate.id,
      },
    });

    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extension/capture',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        url: 'https://shopee.com.br/produto-y-i.333.444',
        marketplaceKind: 'SHOPEE',
        title: 'Produto IDOR',
        price: 10,
        automationRuleId: foreignRule.id,
      },
    });
    expect(captureRes.statusCode).toBe(404);

    await cleanupTenant(other.tenantId);
  });
```

Nota: essa última prova exige que `createTenantWithUser` e `cleanupTenant` estejam importados no
topo do arquivo — confira o import existente (`import { createTenantWithUser, cleanupTenant,
loginCookie } from './helpers';`); se algum desses símbolos não estiver na lista, adicione-o.

- [ ] **Step 3: Rodar os testes e confirmar que os novos falham**

```bash
cd apps/api && npx vitest run test/extension-and-tokens.test.ts 2>&1 | tail -60
```

Expected: os 3 testes novos falham (rota `GET /extension/automations` não existe → 404; captura
com `automationRuleId` ainda cai na Fila de Triagem em vez de criar `AutomationQueueItem`).

- [ ] **Step 4: Implementar `GET /extension/automations`**

Em `apps/api/src/routes/extension.ts`, dentro de `export async function extensionRoutes(app:
FastifyInstance)`, logo depois do bloco `app.route({ method: ['GET', 'POST'], url:
'/extension/auth', ... })` (antes do comentário `// 2. Captura de produto...`), adicione:

```typescript
  // 1.5 Lista as automações ativas do tenant, para a extensão escolher destino da captura
  app.get('/extension/automations', async (req) => {
    const { tenantId } = await authenticateExtension(req);
    const db = forTenant(tenantId);
    const rules = await db.automationRule.findMany({
      where: { enabled: true },
      select: { id: true, name: true, keywords: true, marketplaces: true },
      orderBy: { name: 'asc' },
    });
    return rules;
  });
```

- [ ] **Step 5: Implementar o roteamento de captura para a fila da automação**

No mesmo arquivo, dentro de `app.post('/extension/capture', async (req) => { ... })`, depois do
bloco que calcula `const [savedProduct] = await upsertProducts(tenantDb, tenantId,
[productData]);` e do `if (!savedProduct) { throw ... }` (linhas ~123-126), substitua o restante
do handler (o bloco que faz `prisma.queueItem.upsert(...)` e o `return { ok: true, ... }`) por:

```typescript
    if (body.automationRuleId) {
      const rule = await tenantDb.automationRule.findFirst({ where: { id: body.automationRuleId } });
      if (!rule) throw ApiError.notFound('Automação não encontrada');

      // @ts-expect-error tenantId é injetado pela extensão forTenant
      const queueItem = await tenantDb.automationQueueItem.create({
        data: { ruleId: rule.id, kind: 'PRODUCT', productId: savedProduct.id, manual: true },
      });
      await app.events.publish(tenantId, { type: 'automation.queue.updated', ruleId: rule.id });
      return {
        ok: true,
        product: toApiProduct(savedProduct),
        automationQueueItem: { id: queueItem.id, ruleId: rule.id },
      };
    }

    // Adiciona na Fila de Triagem como selecionado
    const queueItem = await prisma.queueItem.upsert({
      where: {
        tenantId_productId: {
          tenantId,
          productId: savedProduct.id,
        },
      },
      update: {
        selected: true,
        status: 'PENDING',
      },
      create: {
        tenantId,
        productId: savedProduct.id,
        selected: true,
        status: 'PENDING',
      },
    });

    await app.events.publish(tenantId, { type: 'queue.updated' });

    return {
      ok: true,
      product: toApiProduct(savedProduct),
      queueItem: {
        id: queueItem.id,
        selected: queueItem.selected,
        status: queueItem.status,
      },
    };
  });
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

```bash
cd apps/api && npx vitest run test/extension-and-tokens.test.ts
```

Expected: todos os testes do arquivo passam, incluindo os 3 novos.

- [ ] **Step 7: Typecheck**

```bash
cd /d/apps/afilados
pnpm --filter @afilados/shared typecheck
pnpm --filter @afilados/api typecheck
```

Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/api.ts apps/api/src/routes/extension.ts apps/api/test/extension-and-tokens.test.ts
git commit -m "feat(api): extensão pode enviar produto direto para a fila de uma automação

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Extensão — seletor de destino no popup

**Files:**
- Modify: `apps/extension/popup/popup.html`
- Modify: `apps/extension/popup/popup.js`

**Interfaces:**
- Consumes: `GET /extension/automations` (Task 5) via `fetch`; `POST /extension/capture` (Task
  5) aceitando `automationRuleId` no payload; `chrome.storage.local` (já usado no arquivo para
  `apiUrl`/`apiToken`/`mlSessionSync`).
- Produces: nenhuma interface nova consumida por outro arquivo — a extensão é o consumidor
  final.

- [ ] **Step 1: Adicionar o `<select>` de destino no HTML**

Em `apps/extension/popup/popup.html`, dentro da seção `<div id="product-section" ...>`, logo
antes do `<button id="btn-capture" ...>` (ver em volta da linha 56-57), adicione:

```html
        <label class="label" for="capture-target">Enviar para</label>
        <select id="capture-target" class="input"></select>

        <button id="btn-capture" class="btn btn-action">⚡ Enviar para Fila de Triagem</button>
```

- [ ] **Step 2: Carregar as automações e persistir a última escolha em `popup.js`**

Em `apps/extension/popup/popup.js`, logo depois da declaração de `const captureStatus =
document.getElementById('capture-status');` (linha 13), adicione:

```javascript
  const captureTarget = document.getElementById('capture-target');
```

Depois do bloco `const isAuthed = await checkAuth();` (linha 90), e antes de `// --- Sessão do
Mercado Livre ...` adicione:

```javascript
  // --- Destino da captura: Fila de Triagem (padrão) ou uma automação ---
  let automationRules = [];

  function updateCaptureButtonLabel() {
    const selected = captureTarget.value;
    if (!selected) {
      btnCapture.textContent = '⚡ Enviar para Fila de Triagem';
      return;
    }
    const rule = automationRules.find((r) => r.id === selected);
    btnCapture.textContent = rule ? `⚡ Enviar para: ${rule.name}` : '⚡ Enviar para Fila de Triagem';
  }

  async function loadAutomationTargets() {
    if (!isAuthed) return;
    try {
      const url = `${normalizeApiUrl(config.apiUrl)}/api/v1/extension/automations`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.apiToken}` },
      });
      if (!res.ok) return;
      automationRules = await res.json();
    } catch {
      automationRules = [];
    }

    captureTarget.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Fila de Triagem';
    captureTarget.appendChild(defaultOpt);
    for (const rule of automationRules) {
      const opt = document.createElement('option');
      opt.value = rule.id;
      opt.textContent = rule.name;
      captureTarget.appendChild(opt);
    }

    if (typeof chrome !== 'undefined' && chrome.storage) {
      const { lastCaptureTarget } = await chrome.storage.local.get(['lastCaptureTarget']);
      if (lastCaptureTarget && automationRules.some((r) => r.id === lastCaptureTarget)) {
        captureTarget.value = lastCaptureTarget;
      }
    }
    updateCaptureButtonLabel();
  }

  captureTarget.addEventListener('change', async () => {
    updateCaptureButtonLabel();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ lastCaptureTarget: captureTarget.value });
    }
  });

  await loadAutomationTargets();
```

- [ ] **Step 3: Incluir `automationRuleId` no payload de captura**

Ainda em `apps/extension/popup/popup.js`, dentro do listener `btnCapture.addEventListener('click',
async () => { ... })` (linhas 255-297), no objeto `payload` (linhas 262-271), adicione o campo
condicional logo antes do fechamento `};`:

```javascript
    const payload = {
      url: currentProduct.url,
      marketplaceKind: currentProduct.marketplaceKind,
      ...(currentProduct.title ? { title: currentProduct.title } : {}),
      ...(currentProduct.price !== null && currentProduct.price !== undefined ? { price: currentProduct.price } : {}),
      ...(currentProduct.originalPrice ? { originalPrice: currentProduct.originalPrice } : {}),
      ...(currentProduct.discountPct ? { discountPct: currentProduct.discountPct } : {}),
      ...(currentProduct.images && currentProduct.images.length > 0 ? { images: currentProduct.images } : {}),
      ...(currentProduct.shipping && currentProduct.shipping !== 'UNKNOWN' ? { shipping: currentProduct.shipping } : {}),
      ...(currentProduct.couponCode ? { couponCode: currentProduct.couponCode } : {}),
      ...(captureTarget.value ? { automationRuleId: captureTarget.value } : {}),
    };
```

E ajuste a mensagem de sucesso (linha ~286-288) para refletir o destino escolhido:

```javascript
      if (res.ok) {
        const destino = captureTarget.value
          ? `automação "${automationRules.find((r) => r.id === captureTarget.value)?.name ?? ''}"`
          : 'Fila de Triagem';
        captureStatus.textContent = `✅ Oferta adicionada em ${destino}!`;
        captureStatus.className = 'msg msg-success';
        btnCapture.textContent = '✓ Adicionado';
      } else {
```

- [ ] **Step 4: Recarregar a lista de automações após reconectar**

Ainda em `popup.js`, dentro do listener `btnSaveConfig.addEventListener('click', async () => {
... })` (linhas 141-158), depois da linha `setTimeout(() => inspectCurrentTab(), 500);`,
adicione:

```javascript
      void loadAutomationTargets();
```

- [ ] **Step 5: Verificação manual**

```bash
cd apps/extension && npm run build 2>/dev/null || true
```

Carregue a extensão descompactada (`chrome://extensions` → Load unpacked →
`apps/extension/dist/afilados-connect` ou a pasta raiz da extensão, conforme o fluxo já usado
neste projeto) e confirme visualmente: (a) o seletor "Enviar para" lista a Fila de Triagem e
as automações ativas do tenant conectado; (b) trocar a seleção muda o texto do botão; (c)
capturar um produto com uma automação selecionada faz o item aparecer na fila daquela automação
no painel (não na Fila de Triagem); (d) fechar e reabrir o popup mantém a última escolha.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/popup/popup.html apps/extension/popup/popup.js
git commit -m "feat(extension): seletor de destino no popup para enviar direto a uma automação

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Verificação final

- [ ] Rodar a suíte completa e confirmar que só os 2 testes pré-existentes documentados falham:

```bash
cd /d/apps/afilados
pnpm -r test 2>&1 | tail -80
```

- [ ] Rebuild e subida dos containers para teste end-to-end:

```bash
docker compose build api worker web && docker compose up -d api worker web
```

- [ ] Fluxo manual completo: capturar um link pela extensão direto numa automação → ver o item
  aparecer na fila do painel com o badge de marketplace certo → arrastar para reordenar → ligar
  a automação e confirmar (via `AutomationLog`) que o disparo seguiu a ordem da tela.
