# Envio manual e despacho de cupons — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir enviar mensagens livres e cupons cadastrados (selecionados na tela de cupons) para grupos de WhatsApp e chats do Telegram, agora ou pela fila de lotes, com template de cupom de exemplo.

**Architecture:** `BatchItem` ganha `customText`/`customImageUrl` para mensagens avulsas. A API cria sempre um `Batch` (função única `createDispatchBatch`) — "agora" agenda tudo para `now`, "fila" usa `scheduleBatch`. O worker `send-offer` ganha um ramo `customText` e continua sendo o único caminho de envio (rate limit, janela, `SendLog`, Telegram). A web ganha um `DispatchTargetPicker` compartilhado, uma barra de ações na tela de cupons e a página `/envio-manual`.

**Tech Stack:** pnpm/turbo monorepo, Prisma 5 + Postgres, Fastify + zod (api), BullMQ (worker), Next.js + React Query + vitest/testing-library (web). Testes: vitest em todos os pacotes.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-30-envio-manual-cupons-design.md`.
- Fora do escopo: captura de cupons pelo espelhamento; novas fontes de cupom além de AliExpress e Awin; agendamento por data/hora específica.
- Nenhum caminho de envio paralelo: todo envio passa por `Batch` → `send-offer`.
- Tudo escopado por tenant (`req.db` é o client por tenant).
- Textos de UI em pt-BR; commits em português, estilo `feat(escopo): ...`, terminando com as duas linhas de atribuição abaixo.
- Manter Baileys em 6.7.24 (não mexer em dependências).
- No Windows/Git Bash, usar `MSYS_NO_PATHCONV=1` em `docker exec -w /app/...`.
- Antes de dar como concluído: rebuild e validação no Docker (Task 10).
- Desvios deliberados da spec: (a) página manual em `/envio-manual` (o menu marca ativo por `startsWith('/enviar')`); (b) a prévia de template usa `POST /templates/preview` estendido com `kind` e `couponId` (o editor pré-visualiza texto ainda não salvo, então não cabe `GET /templates/:id/preview`); (c) "Enviar agora" grava `intervalMin = 1` (não 0) e `runAt = agora` em todos os itens, limitados pelo rate limit do worker.

Atribuição de commit (colar no fim de toda mensagem de commit):

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH
```

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Modificar | `BatchItem.customText`, `customImageUrl` |
| `packages/db/prisma/migrations/20260930140000_batch_item_custom_message/migration.sql` | Criar | Colunas novas |
| `packages/db/test/batch-item-custom.test.ts` | Criar | Persistência dos campos |
| `packages/shared/src/dispatch.ts` | Criar | Schemas zod e tipos de despacho |
| `packages/shared/src/index.ts` | Modificar | Exportar `dispatch` |
| `packages/shared/src/api.ts` | Modificar | `kind` em `templateSchema`; `kind`/`couponId` em `templatePreviewSchema` |
| `packages/shared/src/queues.ts` | Modificar | `SendTelegramJob.customText/customImageUrl` |
| `packages/shared/test/dispatch.test.ts` | Criar | Testes dos schemas |
| `apps/worker/src/processors/send-offer.ts` | Modificar | Ramo `customText` |
| `apps/worker/src/processors/send-telegram.ts` | Modificar | Ramo `customText` |
| `apps/worker/test/send-offer.test.ts` | Modificar | Testes do ramo |
| `apps/worker/test/send-telegram-custom.test.ts` | Criar | Teste do Telegram com texto livre |
| `apps/api/src/lib/dispatch.ts` | Criar | `assertDispatchTargets`, `requireConnectedSession`, `createDispatchBatch`, `dispatchBatchName` |
| `apps/api/src/routes/batches.ts` | Modificar | `assertTargets` delega para a lib |
| `apps/api/src/routes/coupons.ts` | Modificar | `POST /coupons/dispatch` |
| `apps/api/src/routes/manual-send.ts` | Criar | `POST /manual-send` |
| `apps/api/src/app.ts` | Modificar | Registrar `manualSendRoutes` |
| `apps/api/src/lib/batches.ts` | Modificar | `SAMPLE_COUPON` |
| `apps/api/src/routes/templates.ts` | Modificar | `kind`, prévia de cupom, `POST /templates/coupon-example` |
| `apps/api/test/dispatch.test.ts` | Criar | Testes de `/coupons/dispatch` e `/manual-send` |
| `apps/api/test/templates-kind.test.ts` | Criar | Testes de `kind`, prévia e exemplo |
| `apps/web/src/lib/types.ts` | Modificar | `Template.kind` |
| `apps/web/src/lib/queries.ts` | Modificar | `useTemplates(kind?)` |
| `apps/web/src/lib/dispatch-target.ts` | Criar | Tipo `DispatchTarget`, persistência, hook `useDispatchTarget` |
| `apps/web/src/components/dispatch/dispatch-target-picker.tsx` | Criar | Seletor de destino compartilhado |
| `apps/web/src/components/coupons/coupon-dispatch-bar.tsx` | Criar | Barra de ações em lote |
| `apps/web/src/components/coupons/sync-feedback.ts` | Criar | Texto do resultado da sincronização |
| `apps/web/src/app/(app)/config/cupons/page.tsx` | Modificar | Seleção, barra, feedback |
| `apps/web/src/app/(app)/envio-manual/page.tsx` | Criar | Página de envio manual |
| `apps/web/src/components/app-shell/sidebar.tsx` | Modificar | Item "Envio manual" |
| `apps/web/src/components/templates/template-editor.tsx` | Modificar | Tipo do template, variáveis de cupom, prévia com cupom real |
| `apps/web/src/app/(app)/config/templates/page.tsx` | Modificar | Tipo, botão de exemplo, prévia de cupom |
| `apps/web/src/app/(app)/enviar/page.tsx` | Modificar | Só templates de produto no formulário de lote |
| `apps/web/test/*.test.tsx` | Criar/Modificar | Testes da web |

---

### Task 1: Campos de mensagem livre em BatchItem

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `BatchItem`, ~linha 393)
- Create: `packages/db/prisma/migrations/20260930140000_batch_item_custom_message/migration.sql`
- Test: `packages/db/test/batch-item-custom.test.ts`

**Interfaces:**
- Produces: `BatchItem.customText: string | null`, `BatchItem.customImageUrl: string | null` (client Prisma regenerado). Tasks 3 e 4 dependem desses nomes.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/db/test/batch-item-custom.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/index';

let tenantId: string | undefined;

afterAll(async () => {
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('BatchItem mensagem livre', () => {
  it('persiste customText e customImageUrl sem produto nem cupom', async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'custom-msg' } });
    tenantId = tenant.id;
    const session = await prisma.waSession.create({
      data: { tenantId, label: 's', status: 'CONNECTED' },
    });
    const template = await prisma.template.create({
      data: { tenantId, name: 't', body: '{link}' },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId: session.id,
        templateId: template.id,
        name: 'manual',
        groupJids: ['g1@g.us'],
        intervalMin: 1,
        items: {
          create: [
            {
              order: 0,
              runAt: new Date(),
              customText: 'Aviso importante',
              customImageUrl: 'https://img.example/a.jpg',
            },
          ],
        },
      },
      include: { items: true },
    });
    const item = batch.items[0]!;
    expect(item.productId).toBeNull();
    expect(item.couponId).toBeNull();
    expect(item.customText).toBe('Aviso importante');
    expect(item.customImageUrl).toBe('https://img.example/a.jpg');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/db exec vitest run test/batch-item-custom.test.ts`
Expected: FAIL (erro de validação do Prisma: `Unknown argument customText`).

- [ ] **Step 3: Alterar o schema e criar a migration**

Em `packages/db/prisma/schema.prisma`, no `model BatchItem`, logo após a linha `coupon    Coupon?         @relation(fields: [couponId], references: [id])`, acrescentar:

```prisma
  /// Mensagem avulsa (envio manual): texto já final, sem template.
  customText     String?
  customImageUrl String?
```

Criar `packages/db/prisma/migrations/20260930140000_batch_item_custom_message/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "BatchItem" ADD COLUMN "customText" TEXT,
ADD COLUMN "customImageUrl" TEXT;
```

- [ ] **Step 4: Aplicar a migration e regenerar o client**

Run: `pnpm --filter @afilados/db migrate:deploy && pnpm --filter @afilados/db generate`
Expected: `Applying migration 20260930140000_batch_item_custom_message` e `Generated Prisma Client`.

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @afilados/db exec vitest run test/batch-item-custom.test.ts`
Expected: PASS (1 teste).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260930140000_batch_item_custom_message packages/db/test/batch-item-custom.test.ts
git commit -m "feat(db): BatchItem aceita mensagem livre (customText/customImageUrl)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 2: Schemas compartilhados

**Files:**
- Create: `packages/shared/src/dispatch.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/api.ts`, `packages/shared/src/queues.ts`
- Test: `packages/shared/test/dispatch.test.ts`

**Interfaces:**
- Produces (exports de `@afilados/shared`):
  - `DISPATCH_MODES = ['now','queue'] as const`, `type DispatchMode`
  - `MANUAL_TEXT_MAX = 4000`
  - `couponDispatchSchema` → `{ couponIds: string[]; templateId: string; sessionId: string; groupJids: string[]; telegramChatIds: string[]; mode: DispatchMode; intervalMin: number }`
  - `manualSendSchema` → `{ text: string; imageUrl?: string; sessionId: string; groupJids: string[]; telegramChatIds: string[]; mode: DispatchMode; intervalMin: number }`
  - `interface DispatchSkipped { id: string; code: string | null; reason: string }`
  - `interface DispatchResult { batchId: string; name: string; mode: DispatchMode; itemCount: number; firstRunAt: string; skipped: DispatchSkipped[] }`
  - `templateSchema` ganha `kind?: 'PRODUCT' | 'COUPON'`; `templatePreviewSchema` ganha `kind?` e `couponId?`
  - `SendTelegramJob` ganha `customText?: string`, `customImageUrl?: string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/shared/test/dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  couponDispatchSchema,
  manualSendSchema,
  templatePreviewSchema,
  templateSchema,
  MANUAL_TEXT_MAX,
} from '../src';

const targets = { sessionId: 's1', groupJids: ['g1@g.us'], mode: 'now' as const };

describe('couponDispatchSchema', () => {
  it('aplica defaults de telegramChatIds e intervalMin', () => {
    const r = couponDispatchSchema.parse({ couponIds: ['c1'], templateId: 't1', ...targets });
    expect(r.telegramChatIds).toEqual([]);
    expect(r.intervalMin).toBe(10);
  });
  it('exige ao menos um cupom e um grupo', () => {
    expect(
      couponDispatchSchema.safeParse({ couponIds: [], templateId: 't1', ...targets }).success,
    ).toBe(false);
    expect(
      couponDispatchSchema.safeParse({
        couponIds: ['c1'],
        templateId: 't1',
        ...targets,
        groupJids: [],
      }).success,
    ).toBe(false);
  });
  it('rejeita modo inválido', () => {
    expect(
      couponDispatchSchema.safeParse({
        couponIds: ['c1'],
        templateId: 't1',
        ...targets,
        mode: 'later',
      }).success,
    ).toBe(false);
  });
});

describe('manualSendSchema', () => {
  it('apara o texto e aceita imagem opcional', () => {
    const r = manualSendSchema.parse({ text: '  Olá  ', ...targets });
    expect(r.text).toBe('Olá');
    expect(r.imageUrl).toBeUndefined();
  });
  it('rejeita texto vazio, longo demais e imagem que não é URL', () => {
    expect(manualSendSchema.safeParse({ text: '   ', ...targets }).success).toBe(false);
    expect(
      manualSendSchema.safeParse({ text: 'x'.repeat(MANUAL_TEXT_MAX + 1), ...targets }).success,
    ).toBe(false);
    expect(manualSendSchema.safeParse({ text: 'ok', imageUrl: 'nao-url', ...targets }).success).toBe(
      false,
    );
  });
});

describe('templates com kind', () => {
  it('templateSchema aceita kind opcional', () => {
    expect(templateSchema.parse({ name: 'a', body: 'b' }).kind).toBeUndefined();
    expect(templateSchema.parse({ name: 'a', body: 'b', kind: 'COUPON' }).kind).toBe('COUPON');
    expect(templateSchema.safeParse({ name: 'a', body: 'b', kind: 'X' }).success).toBe(false);
  });
  it('templatePreviewSchema aceita kind e couponId', () => {
    const r = templatePreviewSchema.parse({ body: '{codigo}', kind: 'COUPON', couponId: 'c1' });
    expect(r.kind).toBe('COUPON');
    expect(r.couponId).toBe('c1');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/shared exec vitest run test/dispatch.test.ts`
Expected: FAIL (`couponDispatchSchema` não exportado).

- [ ] **Step 3: Implementar**

Criar `packages/shared/src/dispatch.ts`:

```ts
import { z } from 'zod';

export const DISPATCH_MODES = ['now', 'queue'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

/** Mesmo teto do corpo de template (`templateSchema.body`). */
export const MANUAL_TEXT_MAX = 4000;

const dispatchTargets = {
  sessionId: z.string().min(1),
  groupJids: z.array(z.string().min(1)).min(1),
  telegramChatIds: z.array(z.string().min(1)).default([]),
  mode: z.enum(DISPATCH_MODES),
  /** Só vale em `mode: 'queue'`. */
  intervalMin: z.number().int().min(1).max(1440).default(10),
};

export const couponDispatchSchema = z.object({
  couponIds: z.array(z.string().min(1)).min(1).max(200),
  templateId: z.string().min(1),
  ...dispatchTargets,
});
export type CouponDispatchBody = z.infer<typeof couponDispatchSchema>;

export const manualSendSchema = z.object({
  text: z.string().trim().min(1).max(MANUAL_TEXT_MAX),
  imageUrl: z.string().url().max(2000).optional(),
  ...dispatchTargets,
});
export type ManualSendBody = z.infer<typeof manualSendSchema>;

export interface DispatchSkipped {
  id: string;
  code: string | null;
  /** 'invalid' | 'expired' | 'empty-code' | 'not-found' */
  reason: string;
}

export interface DispatchResult {
  batchId: string;
  name: string;
  mode: DispatchMode;
  itemCount: number;
  firstRunAt: string;
  skipped: DispatchSkipped[];
}
```

Em `packages/shared/src/index.ts`, acrescentar a linha `export * from './dispatch';` ao final.

Em `packages/shared/src/api.ts`: acrescentar `TEMPLATE_KINDS,` ao import de `./enums` (entre `SHIPPINGS` e o fechamento) e substituir:

```ts
export const templateSchema = z.object({
  name: z.string().min(1).max(60),
  body: z.string().min(1).max(4000),
  isDefault: z.boolean().optional(),
});
export const templatePreviewSchema = z.object({ body: z.string().min(1).max(4000) });
```

por:

```ts
export const templateSchema = z.object({
  name: z.string().min(1).max(60),
  body: z.string().min(1).max(4000),
  isDefault: z.boolean().optional(),
  kind: z.enum(TEMPLATE_KINDS).optional(),
});
export const templatePreviewSchema = z.object({
  body: z.string().min(1).max(4000),
  kind: z.enum(TEMPLATE_KINDS).optional(),
  couponId: z.string().min(1).optional(),
});
```

Em `packages/shared/src/queues.ts`, na interface `SendTelegramJob`, acrescentar depois de `couponId?: string;`:

```ts
  /** Mensagem livre (envio manual): texto já final. */
  customText?: string;
  customImageUrl?: string;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @afilados/shared exec vitest run test/dispatch.test.ts && pnpm --filter @afilados/shared typecheck`
Expected: PASS (7 testes) e typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): schemas de despacho de cupons e envio manual" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 3: Worker — ramo de mensagem livre (WhatsApp e Telegram)

**Files:**
- Modify: `apps/worker/src/processors/send-offer.ts` (ramo dentro do `try`, linhas ~123 e ~287)
- Modify: `apps/worker/src/processors/send-telegram.ts` (linhas ~153-155)
- Test: `apps/worker/test/send-offer.test.ts`, `apps/worker/test/send-telegram-custom.test.ts`

**Interfaces:**
- Consumes: `BatchItem.customText/customImageUrl` (Task 1), `SendTelegramJob.customText/customImageUrl` (Task 2).
- Produces: item com `customText` é enviado como `{kind:'text'}` ou `{kind:'image', caption}`; o job do Telegram carrega `customText` (e `customImageUrl` se houver).

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/worker/test/send-offer.test.ts`, dentro do `describe('sendOffer', ...)`, logo depois do teste `'envia mensagem de cupom sem produto associado'` (termina na linha ~324), acrescentar:

```ts
  it('envia mensagem livre (texto) sem produto nem cupom', async () => {
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId,
        templateId,
        name: 'manual-texto',
        groupJids: ['g1@g.us'],
        intervalMin: 1,
        items: { create: [{ order: 0, runAt: new Date(), customText: '*Aviso* do dia' }] },
      },
      include: { items: true },
    });
    const itemId = batch.items[0]!.id;

    const r = await sendOffer(deps, itemId);
    expect(r).toEqual({ outcome: 'sent', groups: 1 });
    const msg = gateway.sent[0]!.msg;
    expect(msg).toEqual({ kind: 'text', text: '*Aviso* do dia' });
    const updated = await prisma.batchItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(updated.status).toBe('SENT');
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe(
      'DONE',
    );
  });

  it('mensagem livre com imagem vira imagem com legenda', async () => {
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId,
        templateId,
        name: 'manual-imagem',
        groupJids: ['g1@g.us'],
        intervalMin: 1,
        items: {
          create: [
            {
              order: 0,
              runAt: new Date(),
              customText: 'Legenda',
              customImageUrl: 'https://img/promo.jpg',
            },
          ],
        },
      },
      include: { items: true },
    });
    await sendOffer(deps, batch.items[0]!.id);
    expect(gateway.sent[0]!.msg).toEqual({
      kind: 'image',
      imageUrl: 'https://img/promo.jpg',
      caption: 'Legenda',
    });
  });

  it('mensagem livre enfileira o telegram com customText', async () => {
    const bot = await prisma.telegramBot.create({
      data: { tenantId, label: 'BotC', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    });
    await prisma.telegramChat.create({
      data: {
        tenantId,
        botId: bot.id,
        chatId: '-100777',
        title: 'Canal',
        kind: 'channel',
        botIsAdmin: true,
      },
    });
    const batch = await prisma.batch.create({
      data: {
        tenantId,
        sessionId,
        templateId,
        name: 'manual-telegram',
        groupJids: ['g1@g.us'],
        telegramChatIds: ['-100777'],
        intervalMin: 1,
        items: {
          create: [
            {
              order: 0,
              runAt: new Date(),
              customText: 'Olá Telegram',
              customImageUrl: 'https://img/t.jpg',
            },
          ],
        },
      },
      include: { items: true },
    });
    const item = batch.items[0]!;
    const enqueued: unknown[] = [];
    await sendOffer({ ...deps, enqueueTelegram: async (job) => void enqueued.push(job) }, item.id);
    expect(enqueued).toEqual([
      {
        jobId: `${item.id}--100777`,
        tenantId,
        botId: bot.id,
        chatId: '-100777',
        templateId,
        customText: 'Olá Telegram',
        customImageUrl: 'https://img/t.jpg',
      },
    ]);
  });
```

Criar `apps/worker/test/send-telegram-custom.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { prisma, encryptJson } from '@afilados/db';
import { createShopeeAdapter, createAwinAdapter } from '@afilados/marketplaces';
import type { TelegramClient } from '@afilados/telegram';
import { sendTelegram, type SendTelegramDeps } from '../src/processors/send-telegram';

let tenantId: string;
let botId: string;
let templateId: string;

const sendMessage = vi.fn(async () => ({ messageId: 1 }));
const sendPhoto = vi.fn(async () => ({ messageId: 2 }));
const deps: SendTelegramDeps = {
  shopee: createShopeeAdapter({ mock: true }),
  awin: createAwinAdapter(),
  makeClient: () => ({ sendMessage, sendPhoto }) as unknown as TelegramClient,
};

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'tg-custom' } })).id;
  botId = (
    await prisma.telegramBot.create({
      data: { tenantId, label: 'B', encryptedToken: encryptJson({ token: 'x' }), status: 'OK' },
    })
  ).id;
  templateId = (await prisma.template.create({ data: { tenantId, name: 't', body: '{link}' } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('sendTelegram com texto livre', () => {
  it('envia só texto quando não há imagem', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    await sendTelegram(deps, { tenantId, botId, chatId: '-1', templateId, customText: 'Aviso geral' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0]).toEqual(['-1', expect.stringContaining('Aviso geral')]);
  });

  it('envia foto com legenda quando há customImageUrl', async () => {
    sendMessage.mockClear();
    sendPhoto.mockClear();
    await sendTelegram(deps, {
      tenantId,
      botId,
      chatId: '-1',
      templateId,
      customText: 'Com foto',
      customImageUrl: 'https://img/x.jpg',
    });
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendPhoto.mock.calls[0]).toEqual([
      '-1',
      'https://img/x.jpg',
      expect.stringContaining('Com foto'),
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/worker exec vitest run test/send-offer.test.ts test/send-telegram-custom.test.ts`
Expected: FAIL — os três testes novos do `send-offer` (item sem produto/cupom cai em `'BatchItem sem produto nem cupom'`) e os dois do Telegram (`sendMessage` não chamado).

- [ ] **Step 3: Implementar o ramo no `send-offer.ts`**

Em `apps/worker/src/processors/send-offer.ts`, dentro do `try`, imediatamente antes de `if (item.couponId && coupon) {` (linha ~124), inserir:

```ts
    if (item.customText) {
      const message: OutgoingMessage = item.customImageUrl
        ? { kind: 'image', imageUrl: item.customImageUrl, caption: item.customText }
        : { kind: 'text', text: item.customText };
      return sendPlainMessages(
        deps,
        {
          id: item.id,
          productId: null,
          couponId: null,
          customText: item.customText,
          customImageUrl: item.customImageUrl,
        },
        batch,
        tenantId,
        message,
        now,
        sleep,
        rng,
        bucketFor(batch.sessionId, ratePerMin),
        enqueueTelegram,
      );
    }
```

Na assinatura de `sendPlainMessages`, trocar o tipo do parâmetro `item`:

```ts
  item: { id: string; productId: string | null; couponId: string | null },
```

por:

```ts
  item: {
    id: string;
    productId: string | null;
    couponId: string | null;
    customText?: string | null;
    customImageUrl?: string | null;
  },
```

No `enqueueTelegram({...})` dentro do loop de `telegramChatIds`, logo após a linha `...(item.couponId ? { couponId: item.couponId } : {}),`, acrescentar:

```ts
      ...(item.customText ? { customText: item.customText } : {}),
      ...(item.customImageUrl ? { customImageUrl: item.customImageUrl } : {}),
```

- [ ] **Step 4: Implementar o ramo no `send-telegram.ts`**

Em `apps/worker/src/processors/send-telegram.ts`, substituir o trecho final do `if/else if`:

```ts
      imageUrl = product.images[0];
    } else {
      return;
    }
```

por:

```ts
      imageUrl = product.images[0];
    } else if (job.customText) {
      text = job.customText;
      imageUrl = job.customImageUrl;
    } else {
      return;
    }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @afilados/worker exec vitest run test/send-offer.test.ts test/send-telegram-custom.test.ts && pnpm --filter @afilados/worker typecheck`
Expected: PASS em todos os testes dos dois arquivos (os antigos do `send-offer` continuam verdes) e typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): envia mensagem livre (texto/imagem) por WhatsApp e Telegram" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 4: API — `createDispatchBatch`, `/coupons/dispatch` e `/manual-send`

**Files:**
- Create: `apps/api/src/lib/dispatch.ts`, `apps/api/src/routes/manual-send.ts`
- Modify: `apps/api/src/routes/batches.ts` (função `assertTargets`, linhas 35-68), `apps/api/src/routes/coupons.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/dispatch.test.ts`

**Interfaces:**
- Consumes: schemas e tipos da Task 2; `BatchItem.customText/customImageUrl` da Task 1; `enqueueBatchItems` (`apps/api/src/lib/batches.ts`); `getOperatingWindow`/`toCoreWindow` (`apps/api/src/lib/settings`).
- Produces (`apps/api/src/lib/dispatch.ts`):
  - `assertDispatchTargets(db: TenantClient, sessionId: string, t: { groupJids?: string[] | undefined; telegramChatIds?: string[] | undefined; templateId?: string | undefined }): Promise<void>`
  - `requireConnectedSession(db: TenantClient, sessionId: string): Promise<{ id: string }>`
  - `dispatchBatchName(prefix: string, now: Date, timezone: string): string`
  - `createDispatchBatch(args: CreateDispatchBatchArgs): Promise<DispatchBatchResult>`
- Produces (HTTP): `POST /api/v1/coupons/dispatch` e `POST /api/v1/manual-send`, ambos respondem `201` com `DispatchResult`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/test/dispatch.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { QUEUE_SEND_OFFER } from '@afilados/shared';
import { buildApp } from '../src/app';
import { getQueue } from '../src/lib/redis';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let other: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let sessionId: string;
let offSessionId: string;
let couponTemplateId: string;
let productTemplateId: string;
let validCouponId: string;
let secondCouponId: string;
let expiredCouponId: string;
let foreignCouponId: string;

const targets = () => ({
  sessionId,
  groupJids: ['g1@g.us'],
  telegramChatIds: [] as string[],
});

beforeAll(async () => {
  t = await createTenantWithUser('DispatchTenant');
  other = await createTenantWithUser('DispatchOther');
  cookie = await loginCookie(app, t.email, t.password);
  await getQueue(QUEUE_SEND_OFFER).drain();
  sessionId = (
    await prisma.waSession.create({
      data: { tenantId: t.tenantId, label: 'c', status: 'CONNECTED' },
    })
  ).id;
  offSessionId = (
    await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 'off' } })
  ).id;
  await prisma.waGroup.create({
    data: { tenantId: t.tenantId, sessionId, jid: 'g1@g.us', name: 'G1' },
  });
  productTemplateId = (
    await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } })
  ).id;
  couponTemplateId = (
    await prisma.template.create({
      data: { tenantId: t.tenantId, name: 'Cupom', body: '{codigo} {loja}', kind: 'COUPON' },
    })
  ).id;
  validCouponId = (
    await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'SHOPEE', code: 'VALIDO10', description: '10% off', status: 'VALID' },
    })
  ).id;
  secondCouponId = (
    await prisma.coupon.create({
      data: { tenantId: t.tenantId, store: 'AMAZON', code: 'SEGUNDO5', description: '5% off', status: 'VALID' },
    })
  ).id;
  expiredCouponId = (
    await prisma.coupon.create({
      data: {
        tenantId: t.tenantId,
        store: 'SHOPEE',
        code: 'VELHO',
        description: 'expirado',
        status: 'EXPIRED',
        expiresAt: new Date('2020-01-01'),
      },
    })
  ).id;
  foreignCouponId = (
    await prisma.coupon.create({
      data: { tenantId: other.tenantId, store: 'SHOPEE', code: 'ALHEIO', description: 'x', status: 'VALID' },
    })
  ).id;
});

afterAll(async () => {
  await getQueue(QUEUE_SEND_OFFER).drain();
  await cleanupTenant(t.tenantId);
  await cleanupTenant(other.tenantId);
  await app.close();
});

function dispatch(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/coupons/dispatch', headers: { cookie }, payload });
}
function manual(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/manual-send', headers: { cookie }, payload });
}

describe('POST /coupons/dispatch', () => {
  it('fila: cria lote com os cupons elegíveis, lista os ignorados e enfileira os jobs', async () => {
    const res = await dispatch({
      couponIds: [validCouponId, expiredCouponId, secondCouponId],
      templateId: couponTemplateId,
      mode: 'queue',
      intervalMin: 15,
      ...targets(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.itemCount).toBe(2);
    expect(body.mode).toBe('queue');
    expect(body.skipped).toEqual([{ id: expiredCouponId, code: 'VELHO', reason: 'expired' }]);

    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: body.batchId },
      include: { items: { orderBy: { order: 'asc' } } },
    });
    expect(batch.name.startsWith('Cupons ')).toBe(true);
    expect(batch.intervalMin).toBe(15);
    expect(batch.templateId).toBe(couponTemplateId);
    expect(batch.items.map((i) => i.couponId)).toEqual([validCouponId, secondCouponId]);
    const job = await getQueue(QUEUE_SEND_OFFER).getJob(batch.items[0]!.id);
    expect(job).toBeTruthy();
  });

  it('agora: todos os itens saem com runAt = agora', async () => {
    const before = Date.now();
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(201);
    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: res.json().batchId },
      include: { items: true },
    });
    const diff = Math.abs(batch.items[0]!.runAt.getTime() - before);
    expect(diff).toBeLessThan(10_000);
    expect(batch.intervalMin).toBe(10);
  });

  it('422 quando nenhum cupom é elegível', async () => {
    const res = await dispatch({
      couponIds: [expiredCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(422);
  });

  it('cupom de outro tenant é tratado como não encontrado', async () => {
    const res = await dispatch({
      couponIds: [foreignCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(422);
    expect(await prisma.batch.count({ where: { tenantId: other.tenantId } })).toBe(0);
  });

  it('400 quando o template não é do tipo cupom', async () => {
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: productTemplateId,
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 quando a sessão do WhatsApp está desconectada', async () => {
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      sessionId: offSessionId,
      groupJids: ['g1@g.us'],
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 para grupo desconhecido', async () => {
    const res = await dispatch({
      couponIds: [validCouponId],
      templateId: couponTemplateId,
      mode: 'now',
      sessionId,
      groupJids: ['nao-existe@g.us'],
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /manual-send', () => {
  it('cria lote de uma mensagem livre com texto e imagem', async () => {
    const res = await manual({
      text: '  Aviso importante  ',
      imageUrl: 'https://img.example/a.jpg',
      mode: 'now',
      ...targets(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.itemCount).toBe(1);
    expect(body.skipped).toEqual([]);
    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: body.batchId },
      include: { items: true },
    });
    expect(batch.name.startsWith('Envio manual ')).toBe(true);
    expect(batch.items[0]!.customText).toBe('Aviso importante');
    expect(batch.items[0]!.customImageUrl).toBe('https://img.example/a.jpg');
    expect(batch.items[0]!.productId).toBeNull();
    expect(batch.items[0]!.couponId).toBeNull();
    expect(await getQueue(QUEUE_SEND_OFFER).getJob(batch.items[0]!.id)).toBeTruthy();
  });

  it('fila: agenda o item pela janela de operação', async () => {
    const res = await manual({ text: 'Depois', mode: 'queue', intervalMin: 5, ...targets() });
    expect(res.statusCode).toBe(201);
    expect(new Date(res.json().firstRunAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it('400 com texto vazio e com sessão desconectada', async () => {
    expect((await manual({ text: '   ', mode: 'now', ...targets() })).statusCode).toBe(400);
    expect(
      (
        await manual({
          text: 'oi',
          mode: 'now',
          sessionId: offSessionId,
          groupJids: ['g1@g.us'],
        })
      ).statusCode,
    ).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/api exec vitest run test/dispatch.test.ts`
Expected: FAIL (404 nas duas rotas).

- [ ] **Step 3: Criar `apps/api/src/lib/dispatch.ts`**

```ts
import type { TenantClient } from '@afilados/db';
import { scheduleBatch, type OperatingWindow } from '@afilados/core';
import { ApiError, type DispatchMode } from '@afilados/shared';
import { enqueueBatchItems } from './batches';

export interface DispatchTargetsInput {
  groupJids?: string[] | undefined;
  telegramChatIds?: string[] | undefined;
  templateId?: string | undefined;
}

/** Garante que grupos, chats do Telegram e template existem no tenant. */
export async function assertDispatchTargets(
  db: TenantClient,
  sessionId: string,
  t: DispatchTargetsInput,
) {
  if (t.groupJids) {
    const groups = await db.waGroup.findMany({
      where: { sessionId, jid: { in: t.groupJids } },
      select: { jid: true },
    });
    const known = new Set(groups.map((g) => g.jid));
    const unknown = t.groupJids.filter((j) => !known.has(j));
    if (unknown.length) throw ApiError.validation(`Grupos desconhecidos: ${unknown.join(', ')}`);
  }
  if (t.telegramChatIds?.length) {
    const chats = await db.telegramChat.findMany({
      where: { chatId: { in: t.telegramChatIds } },
      select: { chatId: true },
    });
    const knownChats = new Set(chats.map((c) => c.chatId));
    const unknownChats = t.telegramChatIds.filter((c) => !knownChats.has(c));
    if (unknownChats.length) {
      throw ApiError.validation(`Chats do Telegram desconhecidos: ${unknownChats.join(', ')}`);
    }
  }
  if (t.templateId) {
    const template = await db.template.findFirst({ where: { id: t.templateId } });
    if (!template) throw ApiError.notFound('Template não encontrado');
  }
}

/** Sessão do tenant e conectada; senão `NOT_FOUND` / `WA_NOT_CONNECTED`. */
export async function requireConnectedSession(db: TenantClient, sessionId: string) {
  const session = await db.waSession.findFirst({ where: { id: sessionId } });
  if (!session) throw ApiError.notFound('Sessão não encontrada');
  if (session.status !== 'CONNECTED') {
    throw new ApiError('WA_NOT_CONNECTED', 'WhatsApp não está conectado', 400);
  }
  return session;
}

/** "Cupons 30/09 14:05" — data/hora no fuso da janela de operação. */
export function dispatchBatchName(prefix: string, now: Date, timezone: string): string {
  const stamp = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return `${prefix} ${stamp.replace(',', '')}`;
}

export interface DispatchItemInput {
  couponId?: string;
  customText?: string;
  customImageUrl?: string;
}

export interface CreateDispatchBatchArgs {
  db: TenantClient;
  tenantId: string;
  sessionId: string;
  templateId: string;
  name: string;
  groupJids: string[];
  telegramChatIds: string[];
  mode: DispatchMode;
  intervalMin: number;
  items: DispatchItemInput[];
  window: OperatingWindow;
  now?: Date;
}

export interface DispatchBatchResult {
  batchId: string;
  name: string;
  itemCount: number;
  firstRunAt: Date;
}

/**
 * Cria o lote e enfileira os itens em `send-offer`.
 * `now`: todos os itens com `runAt = agora` (o worker aplica rate limit e janela).
 * `queue`: horários de `scheduleBatch` (janela de operação + intervalo).
 */
export async function createDispatchBatch(
  args: CreateDispatchBatchArgs,
): Promise<DispatchBatchResult> {
  const { db, tenantId, items, mode } = args;
  const now = args.now ?? new Date();
  const schedule =
    mode === 'now'
      ? { runAt: items.map(() => now), estimatedEndAt: now as Date | null }
      : scheduleBatch(items.length, args.intervalMin, args.window, now);

  const batch = await db.batch.create({
    data: {
      tenantId,
      sessionId: args.sessionId,
      templateId: args.templateId,
      name: args.name,
      groupJids: args.groupJids,
      telegramChatIds: args.telegramChatIds,
      intervalMin: args.intervalMin,
      estimatedEndAt: schedule.estimatedEndAt,
      items: {
        create: items.map((it, i) => ({
          order: i,
          runAt: schedule.runAt[i]!,
          couponId: it.couponId ?? null,
          customText: it.customText ?? null,
          customImageUrl: it.customImageUrl ?? null,
        })),
      },
    },
    include: { items: { orderBy: { order: 'asc' } } },
  });

  try {
    await enqueueBatchItems(batch.items, tenantId, now);
  } catch {
    await db.batch.updateMany({ where: { id: batch.id }, data: { status: 'CANCELLED' } });
    await db.batchItem.updateMany({
      where: { id: { in: batch.items.map((i) => i.id) } },
      data: { status: 'ERROR', error: 'falha ao enfileirar' },
    });
    throw new ApiError('INTERNAL', 'Falha ao enfileirar lote', 500);
  }

  return {
    batchId: batch.id,
    name: batch.name,
    itemCount: batch.items.length,
    firstRunAt: schedule.runAt[0]!,
  };
}
```

- [ ] **Step 4: `assertTargets` de `batches.ts` passa a delegar**

Em `apps/api/src/routes/batches.ts`, adicionar ao bloco de imports (depois da linha `import { enqueueBatchItems, removePendingJobs, removeStaleJobs } from '../lib/batches';`):

```ts
import { assertDispatchTargets } from '../lib/dispatch';
```

Substituir a função `assertTargets` inteira (de `async function assertTargets(` até o `}` que a fecha, antes de `/** Recoloca itens com erro`) por:

```ts
async function assertTargets(
  req: FastifyRequest,
  sessionId: string,
  t: {
    groupJids?: string[] | undefined;
    telegramChatIds?: string[] | undefined;
    templateId?: string | undefined;
  },
) {
  return assertDispatchTargets(req.db, sessionId, t);
}
```

- [ ] **Step 5: Rota `POST /coupons/dispatch`**

Em `apps/api/src/routes/coupons.ts`:

Substituir `import { parseCouponsFromText } from '@afilados/core';` por:

```ts
import { isEligibleCoupon, parseCouponsFromText } from '@afilados/core';
```

Substituir o import de `@afilados/shared` por:

```ts
import {
  ApiError,
  couponBulkSchema,
  couponDispatchSchema,
  couponInputSchema,
  couponListQuerySchema,
  couponParseSchema,
  couponVerifySchema,
  QUEUE_COUPON_SYNC,
  type CouponSyncJob,
  type DispatchResult,
  type DispatchSkipped,
} from '@afilados/shared';
```

Acrescentar abaixo de `import { getQueue, getQueueEvents } from '../lib/redis';`:

```ts
import { getOperatingWindow, toCoreWindow } from '../lib/settings';
import {
  assertDispatchTargets,
  createDispatchBatch,
  dispatchBatchName,
  requireConnectedSession,
} from '../lib/dispatch';
```

Dentro de `couponsRoutes`, logo antes de `app.post('/coupons/:id/verify', ...)`, inserir:

```ts
  app.post('/coupons/dispatch', async (req, reply) => {
    const body = couponDispatchSchema.parse(req.body);
    const session = await requireConnectedSession(req.db, body.sessionId);
    await assertDispatchTargets(req.db, session.id, body);
    const template = await req.db.template.findFirst({ where: { id: body.templateId } });
    if (!template) throw ApiError.notFound('Template não encontrado');
    if (template.kind !== 'COUPON') throw ApiError.validation('Use um template do tipo cupom');

    const ids = [...new Set(body.couponIds)];
    const found = await req.db.coupon.findMany({ where: { id: { in: ids } } });
    const byId = new Map(found.map((c) => [c.id, c]));
    const eligible: string[] = [];
    const skipped: DispatchSkipped[] = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) {
        skipped.push({ id, code: null, reason: 'not-found' });
        continue;
      }
      const elig = isEligibleCoupon({
        code: c.code,
        status: c.status,
        expiresAt: c.expiresAt?.toISOString() ?? null,
      });
      if (elig.ok) eligible.push(id);
      else skipped.push({ id, code: c.code, reason: elig.reason });
    }
    if (eligible.length === 0) {
      const why = skipped.map((s) => `${s.code ?? s.id} (${s.reason})`).join(', ');
      throw new ApiError('VALIDATION', `Nenhum cupom elegível para envio: ${why}`, 422);
    }

    const window = toCoreWindow(await getOperatingWindow(req.db, req.tenantId));
    const now = new Date();
    const result = await createDispatchBatch({
      db: req.db,
      tenantId: req.tenantId,
      sessionId: session.id,
      templateId: template.id,
      name: dispatchBatchName('Cupons', now, window.timezone),
      groupJids: body.groupJids,
      telegramChatIds: body.telegramChatIds,
      mode: body.mode,
      intervalMin: body.intervalMin,
      items: eligible.map((couponId) => ({ couponId })),
      window,
      now,
    });
    const out: DispatchResult = {
      batchId: result.batchId,
      name: result.name,
      mode: body.mode,
      itemCount: result.itemCount,
      firstRunAt: result.firstRunAt.toISOString(),
      skipped,
    };
    return reply.status(201).send(out);
  });
```

- [ ] **Step 6: Rota `POST /manual-send` e registro**

Criar `apps/api/src/routes/manual-send.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { ApiError, manualSendSchema, type DispatchResult } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getOperatingWindow, toCoreWindow } from '../lib/settings';
import {
  assertDispatchTargets,
  createDispatchBatch,
  dispatchBatchName,
  requireConnectedSession,
} from '../lib/dispatch';

export async function manualSendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/manual-send', async (req, reply) => {
    const body = manualSendSchema.parse(req.body);
    const session = await requireConnectedSession(req.db, body.sessionId);
    await assertDispatchTargets(req.db, session.id, body);

    // O lote exige um template, mas a mensagem livre não o usa: pega o padrão (ou o mais antigo).
    const template =
      (await req.db.template.findFirst({ where: { isDefault: true } })) ??
      (await req.db.template.findFirst({ orderBy: { createdAt: 'asc' } }));
    if (!template) throw ApiError.validation('Cadastre um template antes de enviar');

    const window = toCoreWindow(await getOperatingWindow(req.db, req.tenantId));
    const now = new Date();
    const result = await createDispatchBatch({
      db: req.db,
      tenantId: req.tenantId,
      sessionId: session.id,
      templateId: template.id,
      name: dispatchBatchName('Envio manual', now, window.timezone),
      groupJids: body.groupJids,
      telegramChatIds: body.telegramChatIds,
      mode: body.mode,
      intervalMin: body.intervalMin,
      items: [{ customText: body.text, ...(body.imageUrl ? { customImageUrl: body.imageUrl } : {}) }],
      window,
      now,
    });
    const out: DispatchResult = {
      batchId: result.batchId,
      name: result.name,
      mode: body.mode,
      itemCount: result.itemCount,
      firstRunAt: result.firstRunAt.toISOString(),
      skipped: [],
    };
    return reply.status(201).send(out);
  });
}
```

Em `apps/api/src/app.ts`, adicionar depois de `import { couponsRoutes } from './routes/coupons';`:

```ts
import { manualSendRoutes } from './routes/manual-send';
```

e depois de `await api.register(couponsRoutes);`:

```ts
      await api.register(manualSendRoutes);
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @afilados/api exec vitest run test/dispatch.test.ts test/batches.test.ts test/coupons.test.ts && pnpm --filter @afilados/api typecheck`
Expected: PASS em todos (o `batches.test.ts` e o `coupons.test.ts` antigos continuam verdes) e typecheck limpo. Se o typecheck reclamar de `isEligibleCoupon` sem `status`, conferir `EligibleCouponInput` em `packages/core/src/eligibility.ts` e ajustar só o objeto passado.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): despacho de cupons e envio manual via lote (agora ou fila)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 5: API — `kind` nos templates, prévia de cupom e template de exemplo

**Files:**
- Modify: `apps/api/src/lib/batches.ts` (acrescentar `SAMPLE_COUPON`), `apps/api/src/routes/templates.ts`
- Test: `apps/api/test/templates-kind.test.ts`

**Interfaces:**
- Consumes: `templateSchema.kind`, `templatePreviewSchema.kind/couponId` (Task 2); `renderCouponTemplate`, `CouponData` de `@afilados/core`.
- Produces: `POST /templates` e `PUT /templates/:id` persistem `kind`; `POST /templates/preview` aceita `{ body, kind: 'COUPON', couponId? }`; `POST /templates/coupon-example` responde `201` (criou) ou `200` (já existia) com o `Template`. Exports de `apps/api/src/routes/templates.ts`: `COUPON_EXAMPLE_NAME`, `COUPON_EXAMPLE_BODY`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/test/templates-kind.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { createTenantWithUser, cleanupTenant, loginCookie } from './helpers';

const app = await buildApp({ logger: false });
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let cookie: string;
let couponId: string;

beforeAll(async () => {
  t = await createTenantWithUser('TemplatesKind');
  cookie = await loginCookie(app, t.email, t.password);
  couponId = (
    await prisma.coupon.create({
      data: {
        tenantId: t.tenantId,
        store: 'AMAZON',
        code: 'REAL15',
        description: '15% em eletrônicos',
        status: 'VALID',
        expiresAt: new Date('2030-12-31T12:00:00Z'),
      },
    })
  ).id;
});
afterAll(async () => {
  await cleanupTenant(t.tenantId);
  await app.close();
});

const call = (method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { cookie }, payload });

describe('templates com kind', () => {
  it('cria template de cupom e devolve kind', async () => {
    const r = await call('POST', '/templates', { name: 'Meu cupom', body: '{codigo}', kind: 'COUPON' });
    expect(r.statusCode).toBe(201);
    expect(r.json().kind).toBe('COUPON');
  });

  it('sem kind o template criado é PRODUCT', async () => {
    const r = await call('POST', '/templates', { name: 'Prod', body: '{titulo}' });
    expect(r.json().kind).toBe('PRODUCT');
  });

  it('PUT sem kind preserva o kind existente', async () => {
    const created = (await call('POST', '/templates', { name: 'Manter', body: '{codigo}', kind: 'COUPON' })).json();
    const r = await call('PUT', `/templates/${created.id}`, { name: 'Manter 2', body: '{codigo} {loja}' });
    expect(r.statusCode).toBe(200);
    expect(r.json().kind).toBe('COUPON');
    expect(r.json().name).toBe('Manter 2');
  });
});

describe('prévia de template de cupom', () => {
  it('sem couponId usa o cupom de exemplo', async () => {
    const r = await call('POST', '/templates/preview', {
      body: '{codigo} na {loja}',
      kind: 'COUPON',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().text).toBe('AFILIADO10 na SHOPEE');
  });

  it('com couponId usa o cupom cadastrado', async () => {
    const r = await call('POST', '/templates/preview', {
      body: '{codigo} - {descricao} - {validade}',
      kind: 'COUPON',
      couponId,
    });
    expect(r.json().text).toBe('REAL15 - 15% em eletrônicos - 31/12/2030');
  });

  it('couponId inexistente → 404', async () => {
    const r = await call('POST', '/templates/preview', { body: '{codigo}', kind: 'COUPON', couponId: 'nao-existe' });
    expect(r.statusCode).toBe(404);
  });

  it('sem kind continua renderizando como produto', async () => {
    const r = await call('POST', '/templates/preview', { body: '{titulo}' });
    expect(r.json().text.length).toBeGreaterThan(0);
  });
});

describe('POST /templates/coupon-example', () => {
  it('cria o exemplo uma única vez', async () => {
    const first = await call('POST', '/templates/coupon-example', {});
    expect(first.statusCode).toBe(201);
    expect(first.json().kind).toBe('COUPON');
    expect(first.json().body).toContain('{codigo}');
    const second = await call('POST', '/templates/coupon-example', {});
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(
      await prisma.template.count({ where: { tenantId: t.tenantId, name: 'Cupom (exemplo)' } }),
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/api exec vitest run test/templates-kind.test.ts`
Expected: FAIL (`kind` vem `PRODUCT`/ausente; prévia ignora `kind`; rota de exemplo 404).

- [ ] **Step 3: `SAMPLE_COUPON`**

Em `apps/api/src/lib/batches.ts`, trocar a linha `import { scheduleBatch, type OperatingWindow } from '@afilados/core';` por:

```ts
import { scheduleBatch, type CouponData, type OperatingWindow } from '@afilados/core';
```

e acrescentar logo depois do bloco `SAMPLE_PRODUCT` (antes de `export async function enqueueBatchItems`):

```ts
export const SAMPLE_COUPON: CouponData = {
  store: 'SHOPEE',
  code: 'AFILIADO10',
  description: '10% de desconto em compras acima de R$ 50',
  expiresAt: null,
};
```

- [ ] **Step 4: Rotas de template**

Substituir o conteúdo de `apps/api/src/routes/templates.ts` por:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderCouponTemplate, renderTemplate, type CouponData } from '@afilados/core';
import { ApiError, templatePreviewSchema, templateSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { SAMPLE_COUPON, SAMPLE_PRODUCT } from '../lib/batches';

const idParam = z.object({ id: z.string().min(1) });

export const COUPON_EXAMPLE_NAME = 'Cupom (exemplo)';
export const COUPON_EXAMPLE_BODY =
  '🎟️ *CUPOM {loja}*\n\nUse o código: *{codigo}*\n{descricao}\n\n⏰ Válido até {validade}';

export async function templatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/templates', async (req) => req.db.template.findMany({ orderBy: { createdAt: 'asc' } }));

  app.post('/templates', async (req, reply) => {
    const body = templateSchema.parse(req.body);
    if (body.isDefault) await req.db.template.updateMany({ where: {}, data: { isDefault: false } });
    const t = await req.db.template.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: {
        name: body.name,
        body: body.body,
        isDefault: body.isDefault ?? false,
        kind: body.kind ?? 'PRODUCT',
      },
    });
    return reply.status(201).send(t);
  });

  app.put('/templates/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = templateSchema.parse(req.body);
    const existing = await req.db.template.findFirst({ where: { id } });
    if (!existing) throw ApiError.notFound('Template não encontrado');
    if (body.isDefault) await req.db.template.updateMany({ where: {}, data: { isDefault: false } });
    await req.db.template.updateMany({
      where: { id },
      data: {
        name: body.name,
        body: body.body,
        isDefault: body.isDefault ?? existing.isDefault,
        kind: body.kind ?? existing.kind,
      },
    });
    return req.db.template.findFirst({ where: { id } });
  });

  app.delete('/templates/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [count, inUse] = await Promise.all([
      req.db.template.count(),
      req.db.batch.count({ where: { templateId: id } }),
    ]);
    if (count <= 1) throw ApiError.validation('Não é possível remover o único template');
    if (inUse > 0) throw ApiError.validation('Template em uso por lotes');
    const r = await req.db.template.deleteMany({ where: { id } });
    if (r.count === 0) throw ApiError.notFound('Template não encontrado');
    return reply.status(204).send();
  });

  app.post('/templates/preview', async (req) => {
    const { body, kind, couponId } = templatePreviewSchema.parse(req.body);
    const now = new Date().toISOString();
    if (kind === 'COUPON') {
      let data: CouponData = SAMPLE_COUPON;
      if (couponId) {
        const coupon = await req.db.coupon.findFirst({ where: { id: couponId } });
        if (!coupon) throw ApiError.notFound('Cupom não encontrado');
        data = {
          store: coupon.store,
          code: coupon.code,
          description: coupon.description,
          expiresAt: coupon.expiresAt?.toISOString() ?? null,
        };
      }
      return { text: renderCouponTemplate(body, data, { now }) };
    }
    return {
      text: renderTemplate(body, SAMPLE_PRODUCT, {
        affiliateLink: 'https://s.shopee.com.br/exemplo',
        now,
      }),
    };
  });

  app.post('/templates/coupon-example', async (req, reply) => {
    const existing = await req.db.template.findFirst({
      where: { name: COUPON_EXAMPLE_NAME, kind: 'COUPON' },
    });
    if (existing) return reply.status(200).send(existing);
    const t = await req.db.template.create({
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      data: { name: COUPON_EXAMPLE_NAME, body: COUPON_EXAMPLE_BODY, isDefault: false, kind: 'COUPON' },
    });
    return reply.status(201).send(t);
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @afilados/api exec vitest run test/templates-kind.test.ts test/batches.test.ts && pnpm --filter @afilados/api typecheck`
Expected: PASS e typecheck limpo. Se `CouponData` não for exportado por `@afilados/core`, conferir `packages/core/src/index.ts`; ele reexporta `./template` (onde `CouponData` é `export interface`). Se o `@ts-expect-error` acusar "Unused", remover só aquele comentário, como no `POST /templates` original.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): templates com kind, prévia de cupom real e template de exemplo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 6: Web — tipos, `useTemplates(kind)` e `DispatchTargetPicker`

**Files:**
- Modify: `apps/web/src/lib/types.ts` (interface `Template`, linha ~210), `apps/web/src/lib/queries.ts` (`useTemplates`, linha 86)
- Create: `apps/web/src/lib/dispatch-target.ts`, `apps/web/src/components/dispatch/dispatch-target-picker.tsx`
- Test: `apps/web/test/dispatch-target-picker.test.tsx`

**Interfaces:**
- Produces:
  - `Template.kind?: 'PRODUCT' | 'COUPON'`
  - `useTemplates(kind?: 'PRODUCT' | 'COUPON')` — sem argumento devolve todos; com argumento filtra (`kind` ausente conta como `PRODUCT`).
  - `interface DispatchTarget { sessionId: string; templateId: string; groupJids: string[]; telegramChatIds: string[]; intervalMin: number }`
  - `EMPTY_TARGET: DispatchTarget`
  - `useDispatchTarget(scope: string): { target: DispatchTarget; update: (patch: Partial<DispatchTarget>) => void }` — carrega/salva em `localStorage` (`afilados:dispatch-target:<scope>`), com try/catch.
  - `<DispatchTargetPicker value={DispatchTarget} onChange={(patch: Partial<DispatchTarget>) => void} templateKind={'COUPON' | null} />` — mostra o seletor de template só quando `templateKind` não é `null`; escolhe sessão conectada, template padrão e remove grupos obsoletos automaticamente via `onChange`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/test/dispatch-target-picker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispatchTargetPicker } from '@/components/dispatch/dispatch-target-picker';
import { EMPTY_TARGET, type DispatchTarget } from '@/lib/dispatch-target';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const sessions = [
  { id: 's1', label: 'Chip 1', phone: '55', status: 'CONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' },
  { id: 's2', label: 'Chip 2', phone: null, status: 'DISCONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' },
];
const groups = [
  { id: 'g1', jid: 'g1@g.us', name: 'Ofertas', kind: 'GROUP', botIsAdmin: true, memberCount: 10 },
  { id: 'g3', jid: 'g3@g.us', name: 'Só membro', kind: 'GROUP', botIsAdmin: false, memberCount: 5 },
];
const templates = [
  { id: 'tp', name: 'Produto', body: '{titulo}', isDefault: true, kind: 'PRODUCT' },
  { id: 'tc1', name: 'Cupom A', body: '{codigo}', isDefault: false, kind: 'COUPON' },
  { id: 'tc2', name: 'Cupom B', body: '{codigo}', isDefault: false, kind: 'COUPON' },
];
const chats = [{ id: 'c1', botId: 'b1', chatId: '-100', title: 'Canal VIP', kind: 'channel', botIsAdmin: true, syncedAt: '' }];

function mockApi() {
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/wa/sessions') return sessions as never;
    if (url.startsWith('/wa/sessions/') && url.endsWith('/groups')) return groups as never;
    if (url === '/telegram/chats') return chats as never;
    if (url === '/templates') return templates as never;
    return {} as never;
  });
}

function renderPicker(value: DispatchTarget, onChange = vi.fn(), templateKind: 'COUPON' | null = 'COUPON') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DispatchTargetPicker value={value} onChange={onChange} templateKind={templateKind} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('DispatchTargetPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('escolhe a 1ª sessão conectada e o 1º template de cupom quando nada está definido', async () => {
    const onChange = renderPicker({ ...EMPTY_TARGET });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ sessionId: 's1' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ templateId: 'tc1' }));
  });

  it('lista só templates do tipo pedido e só grupos em que o bot é admin', async () => {
    renderPicker({ ...EMPTY_TARGET, sessionId: 's1', templateId: 'tc1' });
    await waitFor(() => expect(screen.getByLabelText('[GRUPO] Ofertas')).toBeDefined());
    expect(screen.queryByLabelText('[GRUPO] Só membro')).toBeNull();
    expect(screen.getByRole('option', { name: 'Cupom A' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'Produto' })).toBeNull();
  });

  it('marcar um grupo emite a lista nova de groupJids', async () => {
    const onChange = renderPicker({ ...EMPTY_TARGET, sessionId: 's1', templateId: 'tc1' });
    const box = await screen.findByLabelText('[GRUPO] Ofertas');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ groupJids: ['g1@g.us'] });
  });

  it('remove grupos selecionados que não existem mais', async () => {
    const onChange = renderPicker({
      ...EMPTY_TARGET,
      sessionId: 's1',
      templateId: 'tc1',
      groupJids: ['g1@g.us', 'apagado@g.us'],
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ groupJids: ['g1@g.us'] }));
  });

  it('sem templateKind não mostra o seletor de template', async () => {
    renderPicker({ ...EMPTY_TARGET, sessionId: 's1' }, vi.fn(), null);
    await screen.findByLabelText('[GRUPO] Ofertas');
    expect(screen.queryByLabelText('Template')).toBeNull();
  });

  it('marca chat do Telegram e altera o intervalo', async () => {
    const onChange = renderPicker({ ...EMPTY_TARGET, sessionId: 's1', templateId: 'tc1' });
    fireEvent.click(await screen.findByLabelText('Canal VIP'));
    expect(onChange).toHaveBeenCalledWith({ telegramChatIds: ['-100'] });
    fireEvent.change(screen.getByLabelText('Intervalo na fila (min)'), { target: { value: '25' } });
    expect(onChange).toHaveBeenCalledWith({ intervalMin: 25 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/web exec vitest run test/dispatch-target-picker.test.tsx`
Expected: FAIL (módulos `@/components/dispatch/dispatch-target-picker` e `@/lib/dispatch-target` não existem).

- [ ] **Step 3: Tipo, hook de templates e persistência**

Em `apps/web/src/lib/types.ts`, trocar a interface `Template` por:

```ts
export interface Template {
  id: string;
  name: string;
  body: string;
  isDefault: boolean;
  kind?: 'PRODUCT' | 'COUPON';
}
```

Em `apps/web/src/lib/queries.ts`, trocar:

```ts
export const useTemplates = () =>
  useQuery({ queryKey: ['templates'], queryFn: () => apiFetch<Template[]>('/templates') });
```

por:

```ts
export const useTemplates = (kind?: 'PRODUCT' | 'COUPON') =>
  useQuery({
    queryKey: ['templates'],
    queryFn: () => apiFetch<Template[]>('/templates'),
    select: kind ? (all: Template[]) => all.filter((t) => (t.kind ?? 'PRODUCT') === kind) : undefined,
  });
```

Criar `apps/web/src/lib/dispatch-target.ts`:

```ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DispatchTarget {
  sessionId: string;
  templateId: string;
  groupJids: string[];
  telegramChatIds: string[];
  intervalMin: number;
}

export const EMPTY_TARGET: DispatchTarget = {
  sessionId: '',
  templateId: '',
  groupJids: [],
  telegramChatIds: [],
  intervalMin: 10,
};

const KEY = 'afilados:dispatch-target';

export function loadDispatchTarget(scope: string): Partial<DispatchTarget> {
  try {
    const raw = localStorage.getItem(`${KEY}:${scope}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<DispatchTarget>;
    return {
      ...(typeof parsed.sessionId === 'string' ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed.templateId === 'string' ? { templateId: parsed.templateId } : {}),
      ...(Array.isArray(parsed.groupJids) ? { groupJids: parsed.groupJids.map(String) } : {}),
      ...(Array.isArray(parsed.telegramChatIds)
        ? { telegramChatIds: parsed.telegramChatIds.map(String) }
        : {}),
      ...(typeof parsed.intervalMin === 'number' && parsed.intervalMin >= 1
        ? { intervalMin: parsed.intervalMin }
        : {}),
    };
  } catch {
    return {};
  }
}

export function saveDispatchTarget(scope: string, target: DispatchTarget) {
  try {
    localStorage.setItem(`${KEY}:${scope}`, JSON.stringify(target));
  } catch {
    // armazenamento indisponível: a escolha só não fica lembrada
  }
}

/** Estado do destino com a última escolha lembrada por `scope` (ex.: 'cupons', 'manual'). */
export function useDispatchTarget(scope: string) {
  const [target, setTarget] = useState<DispatchTarget>(EMPTY_TARGET);
  const ref = useRef(target);

  useEffect(() => {
    const next = { ...ref.current, ...loadDispatchTarget(scope) };
    ref.current = next;
    setTarget(next);
  }, [scope]);

  const update = useCallback(
    (patch: Partial<DispatchTarget>) => {
      const next = { ...ref.current, ...patch };
      ref.current = next;
      setTarget(next);
      saveDispatchTarget(scope, next);
    },
    [scope],
  );

  return { target, update };
}
```

- [ ] **Step 4: O componente**

Criar `apps/web/src/components/dispatch/dispatch-target-picker.tsx`:

```tsx
'use client';
import { useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import type { DispatchTarget } from '@/lib/dispatch-target';
import { useGroups, useSessions, useTelegramAllChats, useTemplates } from '@/lib/queries';

const PREFIX = { GROUP: '[GRUPO]', COMMUNITY: '[COMUNIDADE]', CHANNEL: '[CANAL]' } as const;
const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm';

function toggle(list: string[], value: string, on: boolean) {
  const set = new Set(list);
  if (on) set.add(value);
  else set.delete(value);
  return [...set];
}

export function DispatchTargetPicker({
  value,
  onChange,
  templateKind,
}: {
  value: DispatchTarget;
  onChange: (patch: Partial<DispatchTarget>) => void;
  /** `null` esconde o seletor de template (envio manual). */
  templateKind: 'COUPON' | null;
}) {
  const { data: sessions } = useSessions();
  const { data: groups } = useGroups(value.sessionId || null);
  const { data: chats } = useTelegramAllChats();
  const { data: templates } = useTemplates(templateKind ?? undefined);

  const connected = useMemo(
    () => (sessions ?? []).filter((s) => s.status === 'CONNECTED'),
    [sessions],
  );
  const adminGroups = useMemo(() => (groups ?? []).filter((g) => g.botIsAdmin), [groups]);

  // Sessão padrão: a 1ª conectada (ou a lembrada, se ainda existir e estiver conectada).
  useEffect(() => {
    if (!sessions) return;
    if (!connected.some((s) => s.id === value.sessionId) && connected[0]) {
      onChange({ sessionId: connected[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, value.sessionId]);

  // Template padrão: o marcado como padrão do tipo, senão o 1º.
  useEffect(() => {
    if (!templateKind || !templates) return;
    if (!templates.some((t) => t.id === value.templateId) && templates.length > 0) {
      const pick = templates.find((t) => t.isDefault) ?? templates[0]!;
      onChange({ templateId: pick.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, templateKind, value.templateId]);

  // Remove da seleção grupos que não existem mais na sessão.
  useEffect(() => {
    if (!groups) return;
    const known = new Set(groups.map((g) => g.jid));
    const pruned = value.groupJids.filter((j) => known.has(j));
    if (pruned.length !== value.groupJids.length) onChange({ groupJids: pruned });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="dt-session">Sessão WhatsApp</Label>
          <select
            id="dt-session"
            value={value.sessionId}
            onChange={(e) => onChange({ sessionId: e.target.value, groupJids: [] })}
            className={selectCls}
          >
            {(sessions ?? []).map((s) => (
              <option key={s.id} value={s.id} disabled={s.status !== 'CONNECTED'}>
                {s.label} {s.status !== 'CONNECTED' ? `(${s.status})` : ''}
              </option>
            ))}
          </select>
        </div>
        {templateKind && (
          <div>
            <Label htmlFor="dt-template">Template</Label>
            <select
              id="dt-template"
              value={value.templateId}
              onChange={(e) => onChange({ templateId: e.target.value })}
              className={selectCls}
            >
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <Label>Grupos ({value.groupJids.length})</Label>
        <div className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {adminGroups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {(groups ?? []).length === 0
                ? 'Nenhum grupo — sincronize em Configurações → WhatsApp.'
                : 'Nenhum grupo em que este número é administrador.'}
            </p>
          )}
          {adminGroups.map((g) => (
            <label key={g.jid} className="flex items-center gap-2 text-sm">
              <NativeCheckbox
                checked={value.groupJids.includes(g.jid)}
                onChange={(e) =>
                  onChange({ groupJids: toggle(value.groupJids, g.jid, e.target.checked) })
                }
                aria-label={`${PREFIX[g.kind]} ${g.name}`}
              />
              <span className="text-xs text-muted-foreground">{PREFIX[g.kind]}</span> {g.name}
            </label>
          ))}
        </div>
      </div>

      {(chats?.length ?? 0) > 0 && (
        <div>
          <Label>Chats do Telegram (opcional, {value.telegramChatIds.length})</Label>
          <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {chats?.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <NativeCheckbox
                  checked={value.telegramChatIds.includes(c.chatId)}
                  onChange={(e) =>
                    onChange({
                      telegramChatIds: toggle(value.telegramChatIds, c.chatId, e.target.checked),
                    })
                  }
                  aria-label={c.title}
                />
                {c.title}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-[220px]">
        <Label htmlFor="dt-interval">Intervalo na fila (min)</Label>
        <Input
          id="dt-interval"
          type="number"
          min={1}
          value={value.intervalMin}
          onChange={(e) => onChange({ intervalMin: Math.max(1, Number(e.target.value) || 1) })}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @afilados/web exec vitest run test/dispatch-target-picker.test.tsx test/batch-form.test.tsx test/template-editor.test.tsx && pnpm --filter @afilados/web typecheck`
Expected: PASS e typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): DispatchTargetPicker compartilhado e useTemplates por tipo" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 7: Web — seleção de cupons, barra de ações e feedback da sincronização

**Files:**
- Create: `apps/web/src/components/coupons/coupon-dispatch-bar.tsx`, `apps/web/src/components/coupons/sync-feedback.ts`
- Modify: `apps/web/src/app/(app)/config/cupons/page.tsx`
- Test: `apps/web/test/coupon-dispatch.test.tsx`

**Interfaces:**
- Consumes: `DispatchTargetPicker`, `useDispatchTarget`, `EMPTY_TARGET` (Task 6); `POST /coupons/dispatch` (Task 4); `DispatchResult`, `DispatchMode` de `@afilados/shared`.
- Produces:
  - `formatSyncResults(results: SyncResult[] | undefined): string` com `SyncResult = { source: 'ALIEXPRESS' | 'AWIN' | 'EXPIRY'; ok: boolean; created: number; updated: number; expired: number; error?: string }`
  - `<CouponDispatchBar couponIds={string[]} onClear={() => void} />`
  - `isSelectableCoupon(c: ApiCoupon): boolean` (exportada de `coupon-dispatch-bar.tsx`) — `false` para `INVALID`, `EXPIRED` ou `expiresAt` no passado.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/test/coupon-dispatch.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CuponsPage from '@/app/(app)/config/cupons/page';
import { formatSyncResults } from '@/components/coupons/sync-feedback';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const base = {
  tenantId: 't1', scope: '', advertiserName: null, terms: null, discountType: 'PERCENT', discountValue: 10,
  minSpend: null, startsAt: null, origin: 'MANUAL', sourceUrl: null, affiliateUrl: null, externalId: null,
  remainingUses: null, lastSeenAt: null, lastVerifiedAt: null, fetchedAt: '2026-09-25T10:00:00.000Z',
  createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z',
};
const coupons = [
  { ...base, id: 'c1', store: 'SHOPEE', code: 'PROMO10', description: '10% off', status: 'VALID', expiresAt: null },
  { ...base, id: 'c2', store: 'AMAZON', code: 'AMZ5', description: '5% off', status: 'UNVERIFIED', expiresAt: null },
  { ...base, id: 'c3', store: 'SHOPEE', code: 'VELHO', description: 'expirado', status: 'EXPIRED', expiresAt: '2020-01-01T00:00:00.000Z' },
];
const sessions = [{ id: 's1', label: 'Chip', phone: '55', status: 'CONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' }];
const groups = [{ id: 'g1', jid: 'g1@g.us', name: 'Ofertas', kind: 'GROUP', botIsAdmin: true, memberCount: 1 }];
const templates = [{ id: 'tc', name: 'Cupom A', body: '{codigo}', isDefault: false, kind: 'COUPON' }];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CuponsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/coupons/dispatch') {
      return { batchId: 'b1', name: 'Cupons 30/09 14:00', mode: 'queue', itemCount: 2, firstRunAt: new Date().toISOString(), skipped: [] } as never;
    }
    if (url.startsWith('/coupons')) return { coupons } as never;
    if (url === '/wa/sessions') return sessions as never;
    if (url.startsWith('/wa/sessions/')) return groups as never;
    if (url === '/telegram/chats') return [] as never;
    if (url === '/templates') return templates as never;
    return {} as never;
  });
});

describe('seleção e despacho de cupons', () => {
  it('cupom expirado não é selecionável', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    expect((screen.getByLabelText('Selecionar cupom VELHO') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Selecionar cupom PROMO10') as HTMLInputElement).disabled).toBe(false);
  });

  it('a barra só aparece com seleção e mostra a contagem', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    expect(screen.queryByText(/selecionado/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Selecionar cupom PROMO10'));
    expect(await screen.findByText('1 cupom selecionado')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Selecionar cupom AMZ5'));
    expect(await screen.findByText('2 cupons selecionados')).toBeDefined();
  });

  it('"selecionar todos" marca só os elegíveis', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    fireEvent.click(screen.getByLabelText('Selecionar todos os cupons'));
    expect(await screen.findByText('2 cupons selecionados')).toBeDefined();
  });

  it('"Colocar na fila" envia os ids, o template, os grupos e o modo queue', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    fireEvent.click(screen.getByLabelText('Selecionar cupom PROMO10'));
    fireEvent.click(screen.getByLabelText('Selecionar cupom AMZ5'));
    fireEvent.click(await screen.findByLabelText('[GRUPO] Ofertas'));
    const queueBtn = screen.getByRole('button', { name: 'Colocar na fila' });
    await waitFor(() => expect((queueBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(queueBtn);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/coupons/dispatch',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({
            couponIds: ['c1', 'c2'],
            templateId: 'tc',
            sessionId: 's1',
            groupJids: ['g1@g.us'],
            mode: 'queue',
          }),
        }),
      );
    });
  });

  it('"Enviar agora" usa mode now e fica desabilitado sem grupo', async () => {
    renderPage();
    await screen.findByText('PROMO10');
    fireEvent.click(screen.getByLabelText('Selecionar cupom PROMO10'));
    const nowBtn = await screen.findByRole('button', { name: 'Enviar agora' });
    expect((nowBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByLabelText('[GRUPO] Ofertas'));
    await waitFor(() => expect((nowBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(nowBtn);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/coupons/dispatch',
        expect.objectContaining({ json: expect.objectContaining({ mode: 'now' }) }),
      );
    });
  });
});

describe('formatSyncResults', () => {
  it('resume cada fonte e destaca erro', () => {
    expect(
      formatSyncResults([
        { source: 'ALIEXPRESS', ok: true, created: 3, updated: 1, expired: 0 },
        { source: 'AWIN', ok: false, created: 0, updated: 0, expired: 0, error: 'token inválido' },
        { source: 'EXPIRY', ok: true, created: 0, updated: 0, expired: 2 },
      ]),
    ).toBe(
      'AliExpress: 3 novos, 1 atualizado · Awin: erro — token inválido · Expiração: 2 expirados',
    );
  });
  it('sem resultados devolve texto padrão', () => {
    expect(formatSyncResults(undefined)).toBe('Cupons sincronizados com sucesso!');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/web exec vitest run test/coupon-dispatch.test.tsx`
Expected: FAIL (`sync-feedback` inexistente; sem checkboxes na tabela).

- [ ] **Step 3: Texto do resultado da sincronização**

Criar `apps/web/src/components/coupons/sync-feedback.ts`:

```ts
export interface SyncResult {
  source: 'ALIEXPRESS' | 'AWIN' | 'EXPIRY';
  ok: boolean;
  created: number;
  updated: number;
  expired: number;
  error?: string;
}

const LABEL: Record<SyncResult['source'], string> = {
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Awin',
  EXPIRY: 'Expiração',
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatSyncResults(results: SyncResult[] | undefined): string {
  if (!results || results.length === 0) return 'Cupons sincronizados com sucesso!';
  return results
    .map((r) => {
      if (!r.ok) return `${LABEL[r.source]}: erro — ${r.error ?? 'falha desconhecida'}`;
      const parts: string[] = [];
      if (r.source !== 'EXPIRY') {
        parts.push(plural(r.created, 'novo', 'novos'));
        parts.push(plural(r.updated, 'atualizado', 'atualizados'));
      }
      if (r.expired > 0) parts.push(plural(r.expired, 'expirado', 'expirados'));
      return `${LABEL[r.source]}: ${parts.join(', ')}`;
    })
    .join(' · ');
}
```

- [ ] **Step 4: Barra de ações**

Criar `apps/web/src/components/coupons/coupon-dispatch-bar.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { DispatchMode, DispatchResult } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { DispatchTargetPicker } from '@/components/dispatch/dispatch-target-picker';
import { apiFetch } from '@/lib/api';
import { useDispatchTarget } from '@/lib/dispatch-target';
import { useApiMutation } from '@/lib/mutations';
import type { ApiCoupon } from '@/lib/types';

/** Cupom que pode ser enviado: não inválido, não expirado e dentro da validade. */
export function isSelectableCoupon(c: ApiCoupon): boolean {
  if (c.status === 'INVALID' || c.status === 'EXPIRED') return false;
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) return false;
  return true;
}

const SKIP_LABEL: Record<string, string> = {
  expired: 'expirado',
  invalid: 'inválido',
  'empty-code': 'sem código',
  'not-found': 'não encontrado',
};

export function CouponDispatchBar({
  couponIds,
  onClear,
}: {
  couponIds: string[];
  onClear: () => void;
}) {
  const { target, update } = useDispatchTarget('cupons');
  const [lastSkipped, setLastSkipped] = useState<DispatchResult['skipped']>([]);

  const dispatch = useApiMutation(
    (mode: DispatchMode) =>
      apiFetch<DispatchResult>('/coupons/dispatch', {
        method: 'POST',
        json: {
          couponIds,
          templateId: target.templateId,
          sessionId: target.sessionId,
          groupJids: target.groupJids,
          telegramChatIds: target.telegramChatIds,
          mode,
          intervalMin: target.intervalMin,
        },
      }),
    {
      invalidate: [['batches'], ['overview']],
      onSuccess: (res) => {
        setLastSkipped(res.skipped);
        const when =
          res.mode === 'now'
            ? 'enviando agora'
            : `primeiro envio às ${new Date(res.firstRunAt).toLocaleString('pt-BR')}`;
        toast.success(`${res.itemCount} cupom(ns) no lote "${res.name}" — ${when}`);
        onClear();
      },
    },
  );

  const canSend =
    couponIds.length > 0 && !!target.templateId && !!target.sessionId && target.groupJids.length > 0;

  return (
    <div className="sticky bottom-2 z-10 space-y-4 rounded-xl border border-brand/40 bg-card p-4 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {couponIds.length} {couponIds.length === 1 ? 'cupom selecionado' : 'cupons selecionados'}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Limpar seleção
        </Button>
      </div>
      <DispatchTargetPicker value={target} onChange={update} templateKind="COUPON" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="bg-brand text-white hover:bg-brand/90"
          disabled={!canSend || dispatch.isPending}
          onClick={() => dispatch.mutate('now')}
        >
          Enviar agora
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canSend || dispatch.isPending}
          onClick={() => dispatch.mutate('queue')}
        >
          Colocar na fila
        </Button>
      </div>
      {lastSkipped.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Ignorados no último envio:{' '}
          {lastSkipped
            .map((s) => `${s.code ?? s.id} (${SKIP_LABEL[s.reason] ?? s.reason})`)
            .join(', ')}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Página de cupons**

Em `apps/web/src/app/(app)/config/cupons/page.tsx`:

1. Imports — acrescentar depois de `import { CouponChecksDrawer } ...`:

```tsx
import { CouponDispatchBar, isSelectableCoupon } from '@/components/coupons/coupon-dispatch-bar';
import { formatSyncResults, type SyncResult } from '@/components/coupons/sync-feedback';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
```

2. Estado — depois de `const [syncFeedback, setSyncFeedback] = useState<string | null>(null);`:

```tsx
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
```

3. Tipo e texto do sync — trocar:

```tsx
      return apiFetch<{ queued: boolean; results?: any[] }>('/coupons/sync', {
```

por:

```tsx
      return apiFetch<{ queued: boolean; results?: SyncResult[] }>('/coupons/sync', {
```

e trocar `setSyncFeedback('Cupons sincronizados com sucesso!');` por `setSyncFeedback(formatSyncResults(res.results));`.

4. Helpers de seleção — antes de `const validCount = ...`:

```tsx
  const selectable = (coupons ?? []).filter(isSelectableCoupon);
  const selectedCoupons = selectable.filter((c) => selectedIds.has(c.id));
  const allSelected = selectable.length > 0 && selectedCoupons.length === selectable.length;

  const toggleOne = (id: string, on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) =>
    setSelectedIds(on ? new Set(selectable.map((c) => c.id)) : new Set());
```

5. Tabela — no `<TableHeader>`, antes de `<TableHead>Loja</TableHead>`, inserir:

```tsx
              <TableHead className="w-8">
                <NativeCheckbox
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Selecionar todos os cupons"
                />
              </TableHead>
```

Ajustar `colSpan={8}` para `colSpan={9}` nas duas linhas de "Carregando…" e "Nenhum cupom…". No `<TableRow key={c.id}>`, antes de `<TableCell className="font-medium whitespace-nowrap">` (a da loja), inserir:

```tsx
                  <TableCell className="w-8">
                    <NativeCheckbox
                      checked={selectedIds.has(c.id)}
                      disabled={!isSelectableCoupon(c)}
                      onChange={(e) => toggleOne(c.id, e.target.checked)}
                      aria-label={`Selecionar cupom ${c.code}`}
                    />
                  </TableCell>
```

6. Barra — depois do `</div>` que fecha o wrapper da tabela (`rounded-xl border border-border bg-card overflow-hidden`) e antes do comentário `{/* Drawers e Modais */}`:

```tsx
      {selectedCoupons.length > 0 && (
        <CouponDispatchBar
          couponIds={selectedCoupons.map((c) => c.id)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @afilados/web exec vitest run test/coupon-dispatch.test.tsx test/coupons-page.test.tsx && pnpm --filter @afilados/web typecheck`
Expected: PASS (novos e os 4 antigos de `coupons-page`) e typecheck limpo. O valor lembrado em `localStorage` é limpo no `beforeEach` dos testes novos.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): selecionar cupons e enviar agora ou colocar na fila" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 8: Web — página de envio manual e item no menu

**Files:**
- Create: `apps/web/src/app/(app)/envio-manual/page.tsx`
- Modify: `apps/web/src/components/app-shell/sidebar.tsx`
- Test: `apps/web/test/manual-send-page.test.tsx`

**Interfaces:**
- Consumes: `DispatchTargetPicker` (`templateKind={null}`), `useDispatchTarget('manual')`, `useTemplates('COUPON')`, `useCoupons`, `isSelectableCoupon`, `POST /manual-send`, `POST /templates/preview` com `{ body, kind: 'COUPON', couponId }`.
- Produces: rota `/envio-manual`; texto livre + prévia, imagem por URL, painel "Inserir cupom", botões "Enviar agora" / "Colocar na fila".

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/web/test/manual-send-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManualSendPage from '@/app/(app)/envio-manual/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const sessions = [{ id: 's1', label: 'Chip', phone: '55', status: 'CONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' }];
const groups = [{ id: 'g1', jid: 'g1@g.us', name: 'Ofertas', kind: 'GROUP', botIsAdmin: true, memberCount: 1 }];
const templates = [{ id: 'tc', name: 'Cupom A', body: '🎟️ {codigo}', isDefault: false, kind: 'COUPON' }];
const coupon = {
  id: 'c1', tenantId: 't1', store: 'SHOPEE', scope: '', advertiserName: null, code: 'PROMO10',
  description: '10% off', terms: null, discountType: 'PERCENT', discountValue: 10, minSpend: null,
  startsAt: null, expiresAt: null, status: 'VALID', origin: 'MANUAL', sourceUrl: null,
  affiliateUrl: null, externalId: null, remainingUses: null, lastSeenAt: null, lastVerifiedAt: null,
  fetchedAt: '', createdAt: '', updatedAt: '',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ManualSendPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/manual-send') {
      return { batchId: 'b1', name: 'Envio manual 30/09 14:00', mode: 'now', itemCount: 1, firstRunAt: new Date().toISOString(), skipped: [] } as never;
    }
    if (url === '/templates/preview') return { text: '🎟️ PROMO10' } as never;
    if (url.startsWith('/coupons')) return { coupons: [coupon] } as never;
    if (url === '/wa/sessions') return sessions as never;
    if (url.startsWith('/wa/sessions/')) return groups as never;
    if (url === '/telegram/chats') return [] as never;
    if (url === '/templates') return templates as never;
    return {} as never;
  });
});

describe('página de envio manual', () => {
  it('botões ficam desabilitados sem texto e sem grupo', async () => {
    renderPage();
    const nowBtn = await screen.findByRole('button', { name: 'Enviar agora' });
    expect((nowBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('mostra a prévia do texto digitado', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: '*Olá* grupo' } });
    expect(screen.getByTestId('manual-preview').textContent).toContain('Olá');
  });

  it('envia agora com texto, imagem e destino', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: 'Aviso importante' } });
    fireEvent.change(screen.getByLabelText('Imagem (URL, opcional)'), {
      target: { value: 'https://img.example/a.jpg' },
    });
    fireEvent.click(await screen.findByLabelText('[GRUPO] Ofertas'));
    const nowBtn = screen.getByRole('button', { name: 'Enviar agora' });
    await waitFor(() => expect((nowBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(nowBtn);
    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/manual-send',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({
            text: 'Aviso importante',
            imageUrl: 'https://img.example/a.jpg',
            sessionId: 's1',
            groupJids: ['g1@g.us'],
            mode: 'now',
          }),
        }),
      );
    });
  });

  it('inserir cupom acrescenta o texto renderizado ao campo', async () => {
    renderPage();
    const field = (await screen.findByLabelText('Mensagem')) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Veja:' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Inserir cupom PROMO10' }));
    await waitFor(() => expect(field.value).toBe('Veja:\n\n🎟️ PROMO10'));
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/templates/preview',
      expect.objectContaining({
        json: { body: '🎟️ {codigo}', kind: 'COUPON', couponId: 'c1' },
      }),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @afilados/web exec vitest run test/manual-send-page.test.tsx`
Expected: FAIL (página inexistente).

- [ ] **Step 3: A página**

Criar `apps/web/src/app/(app)/envio-manual/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import type { DispatchMode, DispatchResult } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DispatchTargetPicker } from '@/components/dispatch/dispatch-target-picker';
import { isSelectableCoupon } from '@/components/coupons/coupon-dispatch-bar';
import { apiFetch } from '@/lib/api';
import { useDispatchTarget } from '@/lib/dispatch-target';
import { useApiMutation } from '@/lib/mutations';
import { useCoupons, useTemplates } from '@/lib/queries';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function waMarkup(text: string) {
  return escapeHtml(text)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

export default function ManualSendPage() {
  const { target, update } = useDispatchTarget('manual');
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [couponTemplateId, setCouponTemplateId] = useState('');
  const { data: couponTemplates } = useTemplates('COUPON');
  const { data: coupons } = useCoupons({ includeExpired: false });

  const activeTemplate =
    couponTemplates?.find((t) => t.id === couponTemplateId) ?? couponTemplates?.[0];
  const usable = (coupons ?? []).filter(isSelectableCoupon).slice(0, 30);

  const send = useApiMutation(
    (mode: DispatchMode) =>
      apiFetch<DispatchResult>('/manual-send', {
        method: 'POST',
        json: {
          text,
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
          sessionId: target.sessionId,
          groupJids: target.groupJids,
          telegramChatIds: target.telegramChatIds,
          mode,
          intervalMin: target.intervalMin,
        },
      }),
    {
      invalidate: [['batches'], ['overview']],
      onSuccess: (res) => {
        toast.success(
          res.mode === 'now'
            ? 'Mensagem enviando agora'
            : `Mensagem na fila — sai às ${new Date(res.firstRunAt).toLocaleString('pt-BR')}`,
        );
        setText('');
        setImageUrl('');
      },
    },
  );

  const insertCoupon = useApiMutation(
    (couponId: string) =>
      apiFetch<{ text: string }>('/templates/preview', {
        method: 'POST',
        json: { body: activeTemplate!.body, kind: 'COUPON', couponId },
      }),
    {
      onSuccess: (out) => setText((prev) => (prev.trim() ? `${prev}\n\n${out.text}` : out.text)),
    },
  );

  const canSend =
    !!text.trim() && !!target.sessionId && target.groupJids.length > 0 && !send.isPending;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Envio manual</h1>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
            <div>
              <Label htmlFor="manual-text">Mensagem</Label>
              <Textarea
                id="manual-text"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escreva o aviso. Use *negrito*, _itálico_ e ~riscado~."
                className="text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">{text.length}/4000</p>
            </div>
            <div>
              <Label htmlFor="manual-image">Imagem (URL, opcional)</Label>
              <Input
                id="manual-image"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div
              className="rounded-2xl bg-[#005c4b] p-4 text-sm text-white shadow"
              data-testid="manual-preview"
            >
              <div
                className="whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: waMarkup(text) }}
              />
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">Destino</h2>
            <DispatchTargetPicker value={target} onChange={update} templateKind={null} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="bg-brand text-white hover:bg-brand/90"
                disabled={!canSend}
                onClick={() => send.mutate('now')}
              >
                Enviar agora
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canSend}
                onClick={() => send.mutate('queue')}
              >
                Colocar na fila
              </Button>
            </div>
          </div>
        </div>

        <aside className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Inserir cupom</h2>
          {(couponTemplates?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              Crie um template de cupom em Template das mensagens para inserir cupons aqui.
            </p>
          ) : (
            <>
              <div>
                <Label htmlFor="manual-coupon-template">Template do cupom</Label>
                <select
                  id="manual-coupon-template"
                  value={activeTemplate?.id ?? ''}
                  onChange={(e) => setCouponTemplateId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm"
                >
                  {couponTemplates?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="max-h-[420px] space-y-1 overflow-y-auto">
                {usable.length === 0 && (
                  <li className="text-xs text-muted-foreground">Nenhum cupom válido cadastrado.</li>
                )}
                {usable.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-label={`Inserir cupom ${c.code}`}
                      onClick={() => insertCoupon.mutate(c.id)}
                      className="w-full rounded-md border border-border px-2 py-1.5 text-left text-sm hover:border-brand"
                    >
                      <span className="font-mono font-bold text-primary">{c.code}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{c.store}</span>
                      <div className="truncate text-xs text-muted-foreground">{c.description}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
```

Verificar que `useCoupons` aceita `{ includeExpired: false }` (`apps/web/src/lib/queries.ts`; a página de cupons já o chama com o mesmo tipo de filtros) e que devolve `ApiCoupon[]` direto em `data` (a página de cupons usa `coupons?.filter`).

- [ ] **Step 4: Item no menu**

Em `apps/web/src/components/app-shell/sidebar.tsx`, adicionar `PenLine,` à lista de ícones importados de `lucide-react` e inserir, logo depois da linha `{ href: '/enviar', label: 'Enviar Ofertas', icon: Send },`:

```tsx
  { href: '/envio-manual', label: 'Envio manual', icon: PenLine },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @afilados/web exec vitest run test/manual-send-page.test.tsx && pnpm --filter @afilados/web typecheck`
Expected: PASS (4 testes) e typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): página de envio manual com inserção de cupons" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 9: Web — templates de cupom (tipo, exemplo e prévia com cupom real)

**Files:**
- Modify: `apps/web/src/components/templates/template-editor.tsx`, `apps/web/src/app/(app)/config/templates/page.tsx`, `apps/web/src/app/(app)/enviar/page.tsx`
- Test: `apps/web/test/template-editor.test.tsx` (modificar), `apps/web/test/templates-page.test.tsx` (criar)

**Interfaces:**
- Consumes: `Template.kind`, `useTemplates`, `POST /templates` com `kind`, `POST /templates/preview` com `kind`/`couponId`, `POST /templates/coupon-example` (Tasks 2, 5, 6).
- Produces: `TemplateEditor` ganha props `kind: 'PRODUCT' | 'COUPON'` (padrão `'PRODUCT'`), `coupons?: { id: string; code: string }[]` e `preview: (body: string, couponId?: string) => Promise<string>`; `onSave` passa a receber `{ name, body, isDefault, kind }`. Exporta `COUPON_VARS = ['{codigo}', '{loja}', '{descricao}', '{validade}']`.

- [ ] **Step 1: Ler o teste existente do editor**

Ler `apps/web/test/template-editor.test.tsx` por inteiro (não foi lido durante o planejamento) para manter os testes atuais verdes: eles chamam `onSave` com `{ name, body, isDefault }`. Os testes antigos que verificam `onSave` com `toHaveBeenCalledWith({ name, body, isDefault })` precisam passar a incluir `kind: 'PRODUCT'` — é a única alteração permitida neles.

- [ ] **Step 2: Escrever os testes que falham**

Acrescentar ao final de `apps/web/test/template-editor.test.tsx` (reutilizando os imports já existentes; acrescentar `fireEvent`, `screen`, `render`, `vi`, `waitFor` ao import se faltarem):

```tsx
describe('TemplateEditor — cupom', () => {
  it('mostra as variáveis de cupom e não as de produto', () => {
    render(
      <TemplateEditor
        initial={{ id: 't', name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' }}
        kind="COUPON"
        preview={async () => ''}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '{codigo}' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '{titulo}' })).toBeNull();
  });

  it('prévia usa o cupom escolhido', async () => {
    const preview = vi.fn(async () => 'PROMO10');
    render(
      <TemplateEditor
        initial={{ id: 't', name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' }}
        kind="COUPON"
        coupons={[{ id: 'c1', code: 'PROMO10' }]}
        preview={preview}
        onSave={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Pré-visualizar com o cupom'), { target: { value: 'c1' } });
    await waitFor(() => expect(preview).toHaveBeenCalledWith('{codigo}', 'c1'));
  });

  it('onSave inclui o kind', () => {
    const onSave = vi.fn();
    render(
      <TemplateEditor
        initial={{ id: 't', name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' }}
        kind="COUPON"
        preview={async () => ''}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' });
  });
});
```

Criar `apps/web/test/templates-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TemplatesPage from '@/app/(app)/config/templates/page';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

const templates = [
  { id: 'tp', name: 'Produto', body: '{titulo}', isDefault: true, kind: 'PRODUCT' },
  { id: 'tc', name: 'Cupom X', body: '{codigo}', isDefault: false, kind: 'COUPON' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TemplatesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockImplementation(async (url: string) => {
    if (url === '/templates') return templates as never;
    if (url === '/templates/coupon-example') {
      return { id: 'tx', name: 'Cupom (exemplo)', body: '{codigo}', isDefault: false, kind: 'COUPON' } as never;
    }
    if (url === '/templates/preview') return { text: 'prévia' } as never;
    if (url.startsWith('/coupons')) return { coupons: [] } as never;
    return {} as never;
  });
});

describe('página de templates', () => {
  it('identifica os templates de cupom na lista', async () => {
    renderPage();
    expect(await screen.findByText('Cupom X')).toBeDefined();
    expect(screen.getByText('Cupom')).toBeDefined();
  });

  it('botão cria o template de cupom de exemplo', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar template de exemplo de cupom' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/templates/coupon-example',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('"Novo template de cupom" cria com kind COUPON', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Novo template de cupom' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/templates',
        expect.objectContaining({
          method: 'POST',
          json: expect.objectContaining({ kind: 'COUPON' }),
        }),
      ),
    );
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @afilados/web exec vitest run test/template-editor.test.tsx test/templates-page.test.tsx`
Expected: FAIL nos testes novos (props `kind`/`coupons` e botões inexistentes).

- [ ] **Step 4: Editor**

Em `apps/web/src/components/templates/template-editor.tsx`:

1. Depois de `TEMPLATE_VARS`, acrescentar:

```tsx
export const COUPON_VARS = ['{codigo}', '{loja}', '{descricao}', '{validade}'];
```

2. Trocar a assinatura e o início do componente por:

```tsx
export function TemplateEditor({
  initial,
  kind = 'PRODUCT',
  coupons = [],
  onSave,
  onDelete,
  preview,
  saving,
}: {
  initial?: Template;
  kind?: 'PRODUCT' | 'COUPON';
  coupons?: { id: string; code: string }[];
  onSave: (t: { name: string; body: string; isDefault: boolean; kind: 'PRODUCT' | 'COUPON' }) => void;
  onDelete?: () => void;
  preview: (body: string, couponId?: string) => Promise<string>;
  saving?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? (kind === 'COUPON' ? 'Novo template de cupom' : 'Novo template'));
  const [body, setBody] = useState(initial?.body ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [couponId, setCouponId] = useState('');
  const [rendered, setRendered] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const vars = kind === 'COUPON' ? COUPON_VARS : TEMPLATE_VARS;
```

3. No `useEffect` da prévia, trocar `void preview(body)` por `void preview(body, couponId || undefined)` e a lista de dependências `[body, preview]` por `[body, couponId, preview]`.

4. No `onSubmit`, trocar `onSave({ name, body, isDefault });` por `onSave({ name, body, isDefault, kind });`.

5. Trocar `{TEMPLATE_VARS.map((v) => (` por `{vars.map((v) => (`.

6. Trocar o bloco do `Switch` "Template padrão" por (esconde para cupom):

```tsx
        {kind === 'PRODUCT' && (
          <div className="flex items-center gap-2">
            <Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} />
            <Label htmlFor="isDefault">Template padrão</Label>
          </div>
        )}
```

7. Trocar o parágrafo "Blocos condicionais…" por:

```tsx
        {kind === 'PRODUCT' ? (
          <p className="text-xs text-muted-foreground">
            Blocos condicionais: {'{#cupom}…{/cupom}'} só aparecem quando a variável tem valor.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Variáveis de cupom: código, loja, descrição e validade.
          </p>
        )}
```

8. Na coluna da prévia, trocar a linha `<p className="mb-2 text-sm text-muted-foreground">Pré-visualização (produto de exemplo)</p>` por:

```tsx
        {kind === 'COUPON' ? (
          <div className="mb-2 space-y-1">
            <Label htmlFor="preview-coupon">Pré-visualizar com o cupom</Label>
            <select
              id="preview-coupon"
              value={couponId}
              onChange={(e) => setCouponId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm"
            >
              <option value="">Cupom de exemplo</option>
              {coupons.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="mb-2 text-sm text-muted-foreground">Pré-visualização (produto de exemplo)</p>
        )}
```

- [ ] **Step 5: Página de templates**

Substituir o conteúdo de `apps/web/src/app/(app)/config/templates/page.tsx` por:

```tsx
'use client';
import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TemplateEditor } from '@/components/templates/template-editor';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useCoupons, useTemplates } from '@/lib/queries';
import type { Template } from '@/lib/types';
import { cn } from '@/lib/utils';

type TemplateInput = {
  name: string;
  body: string;
  isDefault: boolean;
  kind: 'PRODUCT' | 'COUPON';
};
const INV = [['templates']];

export default function TemplatesPage() {
  const { data: templates } = useTemplates();
  const { data: coupons } = useCoupons({ includeExpired: false });
  const [selected, setSelected] = useState<string | 'new' | 'new-coupon' | null>(null);
  const creatingCoupon = selected === 'new-coupon';
  const creating = selected === 'new' || creatingCoupon;
  const current = creating
    ? undefined
    : (templates?.find((t) => t.id === selected) ?? templates?.[0]);
  const editorKind: 'PRODUCT' | 'COUPON' = creating
    ? creatingCoupon
      ? 'COUPON'
      : 'PRODUCT'
    : (current?.kind ?? 'PRODUCT');

  const create = useApiMutation(
    (t: TemplateInput) => apiFetch<Template>('/templates', { method: 'POST', json: t }),
    {
      invalidate: INV,
      success: 'Template criado',
      onSuccess: (out) => setSelected(out.id),
    },
  );
  const createExample = useApiMutation(
    () => apiFetch<Template>('/templates/coupon-example', { method: 'POST' }),
    {
      invalidate: INV,
      success: 'Template de exemplo pronto',
      onSuccess: (out) => setSelected(out.id),
    },
  );
  const update = useApiMutation(
    ({ id, t }: { id: string; t: TemplateInput }) =>
      apiFetch(`/templates/${id}`, { method: 'PUT', json: t }),
    { invalidate: INV, success: 'Template salvo' },
  );
  const remove = useApiMutation(
    (id: string) => apiFetch(`/templates/${id}`, { method: 'DELETE' }),
    {
      invalidate: INV,
      success: 'Template excluído',
      onSuccess: () => setSelected(null),
    },
  );
  const preview = useCallback(
    (body: string, couponId?: string) =>
      apiFetch<{ text: string }>('/templates/preview', {
        method: 'POST',
        json: { body, kind: editorKind, ...(couponId ? { couponId } : {}) },
      }).then((r) => r.text),
    [editorKind],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Template das mensagens</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => createExample.mutate(undefined)}
            disabled={createExample.isPending}
          >
            Criar template de exemplo de cupom
          </Button>
          <Button variant="outline" onClick={() => setSelected('new-coupon')}>
            Novo template de cupom
          </Button>
          <Button
            onClick={() => setSelected('new')}
            className="bg-brand text-white hover:bg-brand/90"
          >
            Novo template
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <ul className="space-y-1">
          {(templates ?? []).map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setSelected(t.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2',
                  current?.id === t.id && 'bg-brand/15 text-brand',
                )}
              >
                {t.name}
                <span className="flex gap-1">
                  {t.kind === 'COUPON' && <Badge className="bg-amber-500/20 text-amber-500">Cupom</Badge>}
                  {t.isDefault && <Badge className="bg-brand/20 text-brand">Padrão</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <TemplateEditor
          key={`${current?.id ?? selected ?? 'new'}`}
          initial={current}
          kind={editorKind}
          coupons={(coupons ?? []).map((c) => ({ id: c.id, code: c.code }))}
          preview={preview}
          saving={create.isPending || update.isPending}
          onSave={(t) => (current ? update.mutate({ id: current.id, t }) : create.mutate(t))}
          onDelete={
            current && (templates?.length ?? 0) > 1
              ? () => {
                  if (confirm('Excluir este template?')) remove.mutate(current.id);
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Só templates de produto no formulário de lote**

Em `apps/web/src/app/(app)/enviar/page.tsx`, trocar `const { data: templates } = useTemplates();` por `const { data: templates } = useTemplates('PRODUCT');`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @afilados/web exec vitest run && pnpm --filter @afilados/web typecheck`
Expected: toda a suíte web verde (incluindo `template-editor`, `templates-page`, `batch-form`, `queue-panel`) e typecheck limpo. Templates mockados sem `kind` continuam valendo como `PRODUCT`.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): templates de cupom com exemplo e prévia com cupom real" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AMBT2cG4DCJebfG16bspTH"
```

---

### Task 10: Verificação completa e validação no Docker

**Files:** nenhum arquivo novo (ajustes só se algo falhar).

- [ ] **Step 1: Typecheck e testes de todos os pacotes**

Run: `pnpm -r typecheck && pnpm --filter @afilados/shared --filter @afilados/db --filter @afilados/core --filter @afilados/api --filter @afilados/web test`
Expected: tudo verde.

- [ ] **Step 2: Testes do worker, comparando com a linha de base**

Run: `pnpm --filter @afilados/worker test`
Expected: os testes novos (`send-offer` ×3, `send-telegram-custom` ×2) passam. Existem 6 falhas conhecidas e anteriores a este trabalho no worker; se aparecerem, confirmar que são as mesmas da execução em `main` antes das mudanças (comparar os nomes dos testes) e que nenhuma é de `send-offer`.

- [ ] **Step 3: Rebuild do stack no Docker**

Run: `docker compose up -d --build` (na raiz de `D:\apps\afilados`).
Expected: containers `api`, `web`, `worker` saudáveis. A migration `20260930140000_batch_item_custom_message` precisa estar aplicada; se o container da API não a aplicar sozinho, rodar `docker compose exec api pnpm --filter @afilados/db migrate:deploy`.

- [ ] **Step 4: Fumaça no ambiente Docker**

Com o app logado no navegador (ou via API com cookie de sessão):

1. `POST /api/v1/templates/coupon-example` → 201; repetir → 200 com o mesmo `id`.
2. Em `/config/cupons`, selecionar 2 cupons válidos → a barra aparece → "Colocar na fila" → toast com o nome do lote; o lote aparece em `/enviar` com 2 itens e status `SCHEDULED`.
3. Em `/envio-manual`, digitar um texto, escolher um grupo de teste e clicar "Enviar agora" → o `SendLog` do item fica `SENT` e a mensagem chega no grupo (conferir `docker compose logs worker --tail 50`).
4. Inserir um cupom pelo painel lateral → o texto do template renderizado entra no campo.

Expected: os quatro passos funcionam; se algum falhar, corrigir na task correspondente antes de concluir.

- [ ] **Step 5: Fechar**

Resumir ao usuário o que foi entregue, o que foi verificado no Docker e as falhas pré-existentes do worker (se ainda existirem).
