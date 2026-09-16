# Unificação da tela de Marketplaces (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir as 4 páginas soltas de configuração de marketplace (Shopee, Mercado Livre, Amazon, Magalu) por uma única tela `/marketplaces` com grid de cards e um drawer de configuração genérico, e generalizar o mecanismo de cookie de sessão do Mercado Livre (hoje só via extensão) para também aceitar colagem manual, estendendo o armazenamento (não a geração de link) para Amazon e Magalu.

**Architecture:** Backend generaliza o schema de credenciais criptografadas (`TagCredentials`) com um tipo `SessionCookies` compartilhado por `mlSession`/`amazonSession`/`magaluSession`, ganha um endpoint `POST /marketplaces/:kind/session` para colagem manual de cookie (autenticado por sessão web, ao lado do `POST /extension/session` já existente para a extensão). No front, um componente de drawer genérico (`MarketplaceDrawer`) dirigido por um mapa de configuração declarativo por marketplace substitui o `TagConnectionForm` e o formulário próprio do Shopee; uma nova página `/marketplaces` lista os 4 marketplaces em cards e abre o drawer.

**Tech Stack:** Fastify + Zod (API), Next.js App Router + React Query + `@base-ui/react` (web), Prisma + AES-256-GCM (armazenamento), Vitest + Testing Library (testes).

## Global Constraints

- Não alterar o formato de `mlSession` de forma que quebre dados já criptografados existentes — o merge de credenciais deve continuar fazendo spread do objeto anterior (`...prev`).
- O secret/appId da Shopee e os cookies de sessão nunca podem ser devolvidos pela API em texto puro — só booleans/timestamps derivados (`hasSecret`, `...SyncedAt`).
- `POST /marketplaces/:kind/session` só é válido para `MERCADOLIVRE`, `AMAZON`, `MAGALU` (não `SHOPEE`).
- Fora de escopo nesta entrega: correção do bug de mock do Shopee, novos marketplaces (AliExpress/KaBuM!/Nike/etc.), geração real de link via cookie para Amazon/Magalu, mudanças na extensão Chrome.
- Todo texto de UI em português do Brasil, seguindo o tom já usado nas páginas existentes.

---

### Task 1: Generalizar o schema de credenciais de sessão e o parser de cookie (`@afilados/shared`)

**Files:**
- Modify: `packages/shared/src/marketplaces.ts`
- Modify: `packages/shared/src/api.ts:120-129` (schema `extensionSessionSchema` fica como está; adicionar novo schema `marketplaceSessionSchema`)
- Create: `packages/shared/src/cookie-parser.ts`
- Create: `packages/shared/test/cookie-parser.test.ts`
- Modify: `packages/shared/src/index.ts` (exportar o novo módulo)

**Interfaces:**
- Produces: `export interface SessionCookies { cookies: Record<string,string>; syncedAt: string; source: 'extension' | 'manual' }`, `export type MlSession = SessionCookies` (alias mantido para não quebrar imports existentes), `TagCredentials.amazonSession?: SessionCookies`, `TagCredentials.magaluSession?: SessionCookies`, `export const SESSION_FIELD_BY_KIND: Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', 'mlSession' | 'amazonSession' | 'magaluSession'>`, `export function supportsSessionCookie(kind: MarketplaceKind): kind is 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU'`, `export function parseCookieString(raw: string, kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU'): Record<string,string>`, `export const marketplaceSessionSchema = z.object({ cookie: z.string().min(1).max(20000) })`, `export type MarketplaceSessionBody = z.infer<typeof marketplaceSessionSchema>`.
- Consumes: nada (é a base da pirâmide de dependências desta feature).

- [ ] **Step 1: Escrever o teste do parser de cookie (falhando)**

Crie `packages/shared/test/cookie-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCookieString } from '../src/cookie-parser';

describe('parseCookieString', () => {
  it('separa múltiplos cookies no formato nome=valor; nome=valor', () => {
    expect(parseCookieString('MELI_SESSION=abc123; other=xyz', 'MERCADOLIVRE')).toEqual({
      MELI_SESSION: 'abc123',
      other: 'xyz',
    });
  });

  it('trata string sem ";" como valor único do cookie padrão do marketplace', () => {
    expect(parseCookieString('abc123', 'MERCADOLIVRE')).toEqual({ MELI_SESSION: 'abc123' });
    expect(parseCookieString('token-amazon', 'AMAZON')).toEqual({ 'session-id': 'token-amazon' });
    expect(parseCookieString('token-magalu', 'MAGALU')).toEqual({ magalu_session: 'token-magalu' });
  });

  it('trata valor único com "=" de padding base64 como valor único (não confunde com par nome=valor)', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=';
    expect(parseCookieString(token, 'MERCADOLIVRE')).toEqual({ MELI_SESSION: token });
  });

  it('ignora espaços e segmentos vazios', () => {
    expect(parseCookieString('  a=1 ;  ; b=2  ', 'AMAZON')).toEqual({ a: '1', b: '2' });
  });

  it('string vazia retorna objeto vazio', () => {
    expect(parseCookieString('   ', 'MAGALU')).toEqual({});
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `pnpm --filter @afilados/shared test`
Expected: FAIL — `Cannot find module '../src/cookie-parser'`

- [ ] **Step 3: Implementar o parser**

Crie `packages/shared/src/cookie-parser.ts`:

```ts
const DEFAULT_COOKIE_NAME: Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', string> = {
  MERCADOLIVRE: 'MELI_SESSION',
  AMAZON: 'session-id',
  MAGALU: 'magalu_session',
};

const COOKIE_NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Converte uma string de cookie colada pelo usuário em um mapa nome→valor.
 * Só interpreta como múltiplos cookies (formato "nome=valor; nome=valor")
 * quando TODOS os segmentos separados por ";" têm um nome "seguro" antes do
 * primeiro "=" — evita quebrar um valor único em base64 que contenha "="
 * de padding. Caso contrário, a string inteira vira o valor do cookie
 * padrão daquele marketplace.
 */
export function parseCookieString(
  raw: string,
  kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.includes(';')) {
    const segments = trimmed
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const cookies: Record<string, string> = {};
    let allValid = segments.length > 0;
    for (const segment of segments) {
      const idx = segment.indexOf('=');
      const name = idx > 0 ? segment.slice(0, idx).trim() : '';
      if (idx <= 0 || !COOKIE_NAME_RE.test(name)) {
        allValid = false;
        break;
      }
      cookies[name] = segment.slice(idx + 1).trim();
    }
    if (allValid) return cookies;
  }

  return { [DEFAULT_COOKIE_NAME[kind]]: trimmed };
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `pnpm --filter @afilados/shared test`
Expected: PASS (todos os 5 casos de `cookie-parser.test.ts`)

- [ ] **Step 5: Generalizar `TagCredentials`/`MlSession` em `marketplaces.ts`**

Substitua o conteúdo de `packages/shared/src/marketplaces.ts` por:

```ts
import type { MarketplaceKind } from './enums';

/** Credenciais das lojas convertidas por parâmetros na URL (sem API). */
export interface TagCredentials {
  tag?: string; // Amazon: "SEUID-20"; Magalu: nome da loja em magazinevoce.com.br/<loja>
  mattWord?: string; // Mercado Livre: ID do afiliado
  mattTool?: string; // Mercado Livre: número fixo da conta
  /** Sessão logada do Mercado Livre; permite gerar o link oficial meli.la. */
  mlSession?: SessionCookies;
  /** Sessão logada da Amazon (SiteStripe); armazenada nesta fase, sem uso na geração de link ainda. */
  amazonSession?: SessionCookies;
  /** Sessão logada do Magazine Você; armazenada nesta fase, sem uso na geração de link ainda. */
  magaluSession?: SessionCookies;
}

/** Cookies de sessão de um marketplace, sincronizados pela extensão ou colados manualmente. */
export interface SessionCookies {
  cookies: Record<string, string>;
  syncedAt: string; // ISO
  source: 'extension' | 'manual';
}

/** @deprecated use SessionCookies — mantido para não quebrar imports existentes. */
export type MlSession = SessionCookies;

/** Mapa de qual campo de `TagCredentials` guarda a sessão de cada marketplace. */
export const SESSION_FIELD_BY_KIND: Record<
  'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  'mlSession' | 'amazonSession' | 'magaluSession'
> = {
  MERCADOLIVRE: 'mlSession',
  AMAZON: 'amazonSession',
  MAGALU: 'magaluSession',
};

export function supportsSessionCookie(
  kind: MarketplaceKind,
): kind is 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU' {
  return kind === 'MERCADOLIVRE' || kind === 'AMAZON' || kind === 'MAGALU';
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

export function hasTagCredentials(
  kind: MarketplaceKind,
  creds: TagCredentials | null | undefined,
): boolean {
  if (!creds) return false;
  return requiredTagFields(kind).every((f) => typeof creds[f] === 'string' && creds[f]!.length > 0);
}
```

- [ ] **Step 6: Adicionar o schema `marketplaceSessionSchema` em `api.ts`**

Em `packages/shared/src/api.ts`, logo após o bloco `extensionSessionSchema`/`ExtensionSessionBody` (linhas 120-129), adicione:

```ts
export const marketplaceSessionSchema = z.object({
  cookie: z.string().min(1).max(20000),
});
export type MarketplaceSessionBody = z.infer<typeof marketplaceSessionSchema>;
```

- [ ] **Step 7: Exportar o novo módulo em `index.ts`**

Em `packages/shared/src/index.ts`, adicione a linha (ao lado de `marketplaces`):

```ts
export * from './cookie-parser';
```

Arquivo final:

```ts
export * from './enums';
export * from './product';
export * from './search';
export * from './template';
export * from './events';
export * from './errors';
export * from './queues';
export * from './api';
export * from './marketplaces';
export * from './cookie-parser';
```

- [ ] **Step 8: Rodar typecheck e os testes do pacote `shared`**

Run: `pnpm --filter @afilados/shared typecheck && pnpm --filter @afilados/shared test`
Expected: PASS (typecheck sem erros; todos os testes de `packages/shared/test/` passam, incluindo `api.test.ts` e `mirror-schemas.test.ts` que não foram tocados)

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/marketplaces.ts packages/shared/src/api.ts packages/shared/src/cookie-parser.ts packages/shared/src/index.ts packages/shared/test/cookie-parser.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): generaliza credenciais de sessão para além do Mercado Livre

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Endpoint de cookie manual e generalização do `publicConnection` (`@afilados/api`)

**Files:**
- Modify: `apps/api/src/lib/marketplaces.ts:19-39` (`publicConnection`)
- Modify: `apps/api/src/routes/marketplaces.ts` (novo endpoint `POST /marketplaces/:kind/session`)
- Modify: `apps/api/src/routes/extension.ts:163` (marcar `source: 'extension'` explicitamente)
- Modify: `apps/api/test/marketplaces.test.ts` (novos casos de teste)

**Interfaces:**
- Consumes (de `@afilados/shared`, Task 1): `SessionCookies`, `SESSION_FIELD_BY_KIND`, `supportsSessionCookie`, `marketplaceSessionSchema`, `TagCredentials`.
- Produces: `publicConnection(row, kind)` agora retorna também `mlSessionSource`, `amazonSessionSyncedAt`, `amazonSessionSource`, `magaluSessionSyncedAt`, `magaluSessionSource` (todos `string | null`). Novo endpoint `POST /marketplaces/:kind/session` retornando o mesmo shape de `publicConnection`.

- [ ] **Step 1: Escrever os testes de API (falhando)**

Adicione ao final de `apps/api/test/marketplaces.test.ts` (dentro do `describe('marketplaces', ...)`, antes do `});` final):

```ts
  it('rejeita cookie de sessão para SHOPEE', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/SHOPEE/session',
      headers: { cookie },
      payload: { cookie: 'algumvalor' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('aceita cookie manual para AMAZON, marca status OK e nunca devolve o valor do cookie', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/AMAZON/session',
      headers: { cookie },
      payload: { cookie: 'session-id=abc; ubid-acbbr=xyz' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ kind: 'AMAZON', status: 'OK' });
    expect(r.json().amazonSessionSyncedAt).toBeTruthy();
    expect(r.json().amazonSessionSource).toBe('manual');
    expect(JSON.stringify(r.json())).not.toContain('abc');

    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'AMAZON' },
    });
    const creds = decryptJson<{ amazonSession?: { cookies: Record<string, string> } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.amazonSession?.cookies).toEqual({ 'session-id': 'abc', 'ubid-acbbr': 'xyz' });
  });

  it('cookie manual preserva a tag já salva do mesmo marketplace', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/marketplaces/MAGALU',
      headers: { cookie },
      payload: { affiliateTag: 'minhaloja' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/marketplaces/MAGALU/session',
      headers: { cookie },
      payload: { cookie: 'tokenunico' },
    });
    const row = await prisma.marketplaceConnection.findFirstOrThrow({
      where: { tenantId: t.tenantId, kind: 'MAGALU' },
    });
    const creds = decryptJson<{ tag?: string; magaluSession?: { cookies: Record<string, string> } }>(
      Buffer.from(row.encryptedCredentials!),
    );
    expect(creds.tag).toBe('minhaloja');
    expect(creds.magaluSession?.cookies).toEqual({ magalu_session: 'tokenunico' });
  });
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `pnpm --filter @afilados/api test -- marketplaces`
Expected: FAIL — `404` nas duas primeiras chamadas a `/marketplaces/:kind/session` (rota ainda não existe)

- [ ] **Step 3: Generalizar `publicConnection`**

Em `apps/api/src/lib/marketplaces.ts`, substitua a função `publicConnection` (linhas 19-39) por:

```ts
export function publicConnection(
  row: MarketplaceConnection | null,
  kind: MarketplaceConnection['kind'],
) {
  const creds = row?.encryptedCredentials
    ? decryptJson<AnyCreds>(Buffer.from(row.encryptedCredentials))
    : null;
  return {
    kind,
    status: row?.status ?? 'UNCONFIGURED',
    affiliateTag: row?.affiliateTag ?? null,
    appId: creds?.appId ?? null,
    hasSecret: Boolean(creds?.secret),
    mattWord: creds?.mattWord ?? null,
    mattTool: creds?.mattTool ?? null,
    // Sessões sincronizadas (cookies nunca saem daqui, só metadados)
    mlSessionSyncedAt: creds?.mlSession?.syncedAt ?? null,
    mlSessionSource: creds?.mlSession?.source ?? null,
    amazonSessionSyncedAt: creds?.amazonSession?.syncedAt ?? null,
    amazonSessionSource: creds?.amazonSession?.source ?? null,
    magaluSessionSyncedAt: creds?.magaluSession?.syncedAt ?? null,
    magaluSessionSource: creds?.magaluSession?.source ?? null,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastError: row?.lastError ?? null,
  };
}
```

- [ ] **Step 4: Adicionar o endpoint `POST /marketplaces/:kind/session`**

Em `apps/api/src/routes/marketplaces.ts`, atualize os imports do topo:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encryptJson, decryptJson } from '@afilados/db';
import {
  ApiError,
  MARKETPLACE_KINDS,
  marketplaceKindParam,
  marketplaceUpdateSchema,
  marketplaceSessionSchema,
  parseCookieString,
  supportsSessionCookie,
  SESSION_FIELD_BY_KIND,
  type MlSession,
  type TagCredentials,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getAdapter, getShopeeAdapter, publicConnection } from '../lib/marketplaces';
```

E adicione o novo handler logo após o `app.post('/marketplaces/:kind/check', ...)` existente (antes do `}` que fecha `marketplacesRoutes`):

```ts
  app.post('/marketplaces/:kind/session', async (req) => {
    const { kind } = kindParams.parse(req.params);
    if (!supportsSessionCookie(kind)) {
      throw new ApiError('MARKETPLACE_ERROR', `${kind} não aceita cookie de sessão`, 400);
    }
    const { cookie } = marketplaceSessionSchema.parse(req.body);
    const cookies = parseCookieString(cookie, kind);
    const sessionField = SESSION_FIELD_BY_KIND[kind];

    const existing = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    const prev = existing?.encryptedCredentials
      ? decryptJson<TagCredentials>(Buffer.from(existing.encryptedCredentials))
      : {};
    const syncedAt = new Date().toISOString();
    const merged: TagCredentials = {
      ...prev,
      [sessionField]: { cookies, syncedAt, source: 'manual' },
    };
    const data = {
      encryptedCredentials: encryptJson(merged),
      status: 'OK' as const,
      lastCheckedAt: new Date(),
      lastError: null,
    };
    if (existing) {
      await req.db.marketplaceConnection.updateMany({ where: { id: existing.id }, data });
    } else {
      // @ts-expect-error tenantId é injetado pela extensão forTenant
      await req.db.marketplaceConnection.create({ data: { kind, ...data } });
    }
    return publicConnection(await req.db.marketplaceConnection.findFirst({ where: { kind } }), kind);
  });
```

- [ ] **Step 5: Marcar `source: 'extension'` no endpoint da extensão**

Em `apps/api/src/routes/extension.ts:163`, troque:

```ts
    const merged: TagCredentials = { ...prev, mlSession: { cookies, syncedAt } };
```

por:

```ts
    const merged: TagCredentials = { ...prev, mlSession: { cookies, syncedAt, source: 'extension' } };
```

- [ ] **Step 6: Rodar os testes para confirmar que passam**

Run: `pnpm --filter @afilados/api test -- marketplaces`
Expected: PASS (todos os casos antigos + os 3 novos)

- [ ] **Step 7: Rodar a suíte completa da API e o typecheck**

Run: `pnpm --filter @afilados/api typecheck && pnpm --filter @afilados/api test`
Expected: PASS — nenhuma regressão em `extension.test.ts` ou outros arquivos de teste da API

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/marketplaces.ts apps/api/src/routes/marketplaces.ts apps/api/src/routes/extension.ts apps/api/test/marketplaces.test.ts
git commit -m "$(cat <<'EOF'
feat(api): endpoint de cookie manual de sessão para ML/Amazon/Magalu

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Atualizar o tipo `MarketplaceConnection` no front (`@afilados/web`)

**Files:**
- Modify: `apps/web/src/lib/types.ts:37-49`

**Interfaces:**
- Consumes: nenhuma (é só o contrato TS do front espelhando o novo shape de `publicConnection` da Task 2).
- Produces: `MarketplaceConnection` com os campos `mlSessionSource`, `amazonSessionSyncedAt`, `amazonSessionSource`, `magaluSessionSyncedAt`, `magaluSessionSource`, usados pelas Tasks 5-7.

- [ ] **Step 1: Atualizar a interface**

Em `apps/web/src/lib/types.ts`, substitua o bloco `MarketplaceConnection` (linhas 37-49) por:

```ts
export interface MarketplaceConnection {
  kind: MarketplaceKind;
  status: 'UNCONFIGURED' | 'OK' | 'ERROR';
  affiliateTag: string | null;
  appId: string | null;
  hasSecret: boolean;
  mattWord: string | null;
  mattTool: string | null;
  /** Sessão do ML sincronizada (extensão ou colagem manual); gera link oficial meli.la. */
  mlSessionSyncedAt: string | null;
  mlSessionSource: 'extension' | 'manual' | null;
  /** Sessão da Amazon (SiteStripe) sincronizada; armazenada, sem geração de link nesta fase. */
  amazonSessionSyncedAt: string | null;
  amazonSessionSource: 'extension' | 'manual' | null;
  /** Sessão do Magazine Você sincronizada; armazenada, sem geração de link nesta fase. */
  magaluSessionSyncedAt: string | null;
  magaluSessionSource: 'extension' | 'manual' | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}
```

- [ ] **Step 2: Rodar o typecheck do web**

Run: `pnpm --filter @afilados/web typecheck`
Expected: PASS (nenhum outro arquivo lê esses campos ainda, então não há erro de tipo em cascata)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/types.ts
git commit -m "$(cat <<'EOF'
feat(web): tipo MarketplaceConnection reflete sessões generalizadas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Componente de drawer lateral genérico (`components/ui/drawer.tsx`)

**Files:**
- Create: `apps/web/src/components/ui/drawer.tsx`

**Interfaces:**
- Consumes: `@base-ui/react/dialog` (já usado em `apps/web/src/components/ui/dialog.tsx`), `cn` de `'cn'`, `Button` de `@/components/ui/button`.
- Produces: `Drawer`, `DrawerTrigger`, `DrawerPortal`, `DrawerClose`, `DrawerOverlay`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, `DrawerTitle`, `DrawerDescription` — mesma API do `Dialog` existente, mas o `DrawerContent` desliza da direita e ocupa a altura toda da tela (usado pela Task 6).

- [ ] **Step 1: Criar o componente**

Crie `apps/web/src/components/ui/drawer.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from 'cn';

import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

function Drawer({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/20 duration-150 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DialogPrimitive.Popup
        data-slot="drawer-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-popover p-6 text-sm text-popover-foreground shadow-xl outline-none duration-150 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="drawer-close"
            render={<Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="drawer-header" className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('mt-auto flex flex-col gap-2 border-t border-border pt-4', className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className={cn('font-heading text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
```

- [ ] **Step 2: Rodar o typecheck do web**

Run: `pnpm --filter @afilados/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/drawer.tsx
git commit -m "$(cat <<'EOF'
feat(web): componente de drawer lateral genérico

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Config declarativa por marketplace

**Files:**
- Create: `apps/web/src/components/marketplaces/marketplace-config.ts`

**Interfaces:**
- Consumes: `MarketplaceKind` de `@afilados/shared`.
- Produces: `export interface MarketplaceFieldDef`, `export interface MarketplaceConfig`, `export const MARKETPLACE_CONFIGS: Record<MarketplaceKind, MarketplaceConfig>` — consumido pelas Tasks 6 e 7. `MarketplaceFieldDef['key']` é um dos literais `'appId' | 'secret' | 'affiliateTag' | 'mattWord' | 'mattTool'`, que correspondem 1:1 às chaves aceitas por `marketplaceUpdateSchema` (já existente, não alterado por este plano).

- [ ] **Step 1: Criar o arquivo de config**

Crie `apps/web/src/components/marketplaces/marketplace-config.ts`:

```ts
import type { MarketplaceKind } from '@afilados/shared';

export type MarketplaceFieldKey = 'appId' | 'secret' | 'affiliateTag' | 'mattWord' | 'mattTool';

export interface MarketplaceFieldDef {
  key: MarketplaceFieldKey;
  label: string;
  type: 'text' | 'password';
  required: boolean;
  placeholder?: string;
  helpTitle?: string;
  helpContent?: string;
}

export interface MarketplaceConfig {
  kind: MarketplaceKind;
  label: string;
  description: string;
  platformUrl: string;
  fields: MarketplaceFieldDef[];
  supportsSession: boolean;
  sessionCookieName?: string;
  sessionHelpTitle?: string;
  sessionHelpContent?: string;
  /** Só o Mercado Livre tem extensão hoje; exibe um link extra de instalação. */
  extensionUrl?: string;
}

export const MARKETPLACE_CONFIGS: Record<MarketplaceKind, MarketplaceConfig> = {
  SHOPEE: {
    kind: 'SHOPEE',
    label: 'Shopee',
    description: 'Credenciais da Shopee Affiliate Open Platform.',
    platformUrl: 'https://affiliate.shopee.com.br/',
    fields: [
      { key: 'appId', label: 'App Key', type: 'text', required: true },
      { key: 'secret', label: 'Secret', type: 'password', required: true },
      { key: 'affiliateTag', label: 'Tag de afiliado (opcional)', type: 'text', required: false },
    ],
    supportsSession: false,
  },
  MERCADOLIVRE: {
    kind: 'MERCADOLIVRE',
    label: 'Mercado Livre',
    description:
      'Identificadores de afiliado do Mercado Livre — usados como fallback quando a sessão não está sincronizada.',
    platformUrl: 'https://www.mercadolivre.com.br/afiliados',
    fields: [
      {
        key: 'mattWord',
        label: 'matt_word (ID de Afiliado)',
        type: 'text',
        required: true,
        placeholder: 'Ex: minhaid',
        helpTitle: 'Onde encontrar meu matt_word/matt_tool?',
        helpContent:
          'No painel de afiliados do Mercado Livre, gere um link de qualquer produto, abra-o no navegador e copie os valores de matt_word e matt_tool da URL final.',
      },
      {
        key: 'mattTool',
        label: 'matt_tool (Código da Ferramenta/Conta)',
        type: 'text',
        required: true,
        placeholder: 'Ex: 12345678',
      },
    ],
    supportsSession: true,
    sessionCookieName: 'MELI_SESSION',
    sessionHelpTitle: 'Como exportar o cookie?',
    sessionHelpContent:
      'Com a sessão logada no Mercado Livre, abra o DevTools do navegador → Application → Cookies → mercadolivre.com.br e copie o valor do cookie MELI_SESSION (ou cole todos os cookies do domínio, separados por ";").',
    extensionUrl: '/config/extensao',
  },
  AMAZON: {
    kind: 'AMAZON',
    label: 'Amazon BR',
    description: 'Tag de afiliado da Amazon — usada para reescrever links espelhados.',
    platformUrl: 'https://afiliados.amazon.com.br/',
    fields: [
      {
        key: 'affiliateTag',
        label: 'Tag de Associado Amazon',
        type: 'text',
        required: true,
        placeholder: 'Ex: seunome-20',
        helpTitle: 'Onde encontrar minha tag?',
        helpContent: 'É a sua Store ID / Tracking ID no Programa de Associados Amazon.',
      },
    ],
    supportsSession: true,
    sessionCookieName: 'session-id',
    sessionHelpTitle: 'Como exportar o cookie?',
    sessionHelpContent:
      'Cookie de sessão do SiteStripe (opcional; usado em uma etapa futura para gerar links curtos amzn.to). Com a sessão logada em amazon.com.br, copie o valor do cookie "session-id".',
  },
  MAGALU: {
    kind: 'MAGALU',
    label: 'Magazine Luiza',
    description:
      'Identificador da loja no Magazine Você — usado para reescrever links de produtos do Magalu.',
    platformUrl: 'https://www.magazinevoce.com.br/',
    fields: [
      {
        key: 'affiliateTag',
        label: 'Nome da Loja (Magazine Você)',
        type: 'text',
        required: true,
        placeholder: 'Ex: minhaloja',
        helpTitle: 'Onde encontrar o nome da loja?',
        helpContent: 'O identificador da sua loja em magazinevoce.com.br/<sua-loja>.',
      },
    ],
    supportsSession: true,
    sessionCookieName: 'magalu_session',
    sessionHelpTitle: 'Como exportar o cookie?',
    sessionHelpContent:
      'Cookie de sessão do painel Magazine Você (opcional; usado em uma etapa futura para gerar links). Com a sessão logada, copie o valor do cookie de sessão.',
  },
};
```

- [ ] **Step 2: Rodar o typecheck do web**

Run: `pnpm --filter @afilados/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/marketplaces/marketplace-config.ts
git commit -m "$(cat <<'EOF'
feat(web): config declarativa dos 4 marketplaces

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Componente `MarketplaceDrawer` (presentational + teste)

**Files:**
- Create: `apps/web/src/components/marketplaces/marketplace-drawer.tsx`
- Create: `apps/web/test/marketplace-drawer.test.tsx`

**Interfaces:**
- Consumes: `Drawer*` (Task 4), `MARKETPLACE_CONFIGS`/`MarketplaceFieldKey` (Task 5), `MarketplaceConnection` (Task 3), `Button`/`Input`/`Label`/`Textarea` de `@/components/ui/*`, `StatusPill` de `@/components/app-shell/status-pill`, `formatDateTime` de `@/lib/format`.
- Produces: `export interface MarketplaceSubmitPayload { fields: Partial<Record<MarketplaceFieldKey, string>>; cookie: string }`, `export function MarketplaceDrawer(props: { kind: MarketplaceKind; connection?: MarketplaceConnection; open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (payload: MarketplaceSubmitPayload) => Promise<void>; pending: boolean; feedback: string | null })` — usado pela Task 7, que fornece `onSubmit` fazendo PUT + (opcional) POST session + POST check.

- [ ] **Step 1: Escrever o teste do componente (falhando)**

Crie `apps/web/test/marketplace-drawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketplaceDrawer } from '@/components/marketplaces/marketplace-drawer';
import type { MarketplaceConnection } from '@/lib/types';

const baseConnection: MarketplaceConnection = {
  kind: 'AMAZON',
  status: 'UNCONFIGURED',
  affiliateTag: null,
  appId: null,
  hasSecret: false,
  mattWord: null,
  mattTool: null,
  mlSessionSyncedAt: null,
  mlSessionSource: null,
  amazonSessionSyncedAt: null,
  amazonSessionSource: null,
  magaluSessionSyncedAt: null,
  magaluSessionSource: null,
  lastCheckedAt: null,
  lastError: null,
};

describe('MarketplaceDrawer', () => {
  it('envia os campos preenchidos e o cookie ao clicar em Testar e Salvar', async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <MarketplaceDrawer
        kind="AMAZON"
        connection={baseConnection}
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        pending={false}
        feedback={null}
      />,
    );

    fireEvent.change(screen.getByLabelText(/tag de associado amazon/i), {
      target: { value: 'minha-20' },
    });
    fireEvent.change(screen.getByLabelText(/cookie de sessão/i), {
      target: { value: 'session-id=abc123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /testar e salvar/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      fields: { affiliateTag: 'minha-20' },
      cookie: 'session-id=abc123',
    });
  });

  it('não exibe campo de cookie para a Shopee', () => {
    render(
      <MarketplaceDrawer
        kind="SHOPEE"
        connection={{ ...baseConnection, kind: 'SHOPEE' }}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );
    expect(screen.queryByLabelText(/cookie de sessão/i)).not.toBeInTheDocument();
  });

  it('mostra "já salvo" no placeholder do secret quando hasSecret é true', () => {
    render(
      <MarketplaceDrawer
        kind="SHOPEE"
        connection={{ ...baseConnection, kind: 'SHOPEE', hasSecret: true }}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
        pending={false}
        feedback={null}
      />,
    );
    expect(screen.getByLabelText(/secret/i)).toHaveAttribute('placeholder', '•••• (já salvo)');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `pnpm --filter @afilados/web test -- marketplace-drawer`
Expected: FAIL — `Cannot find module '@/components/marketplaces/marketplace-drawer'`

- [ ] **Step 3: Implementar o componente**

Crie `apps/web/src/components/marketplaces/marketplace-drawer.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/app-shell/status-pill';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { formatDateTime } from '@/lib/format';
import type { MarketplaceConnection } from '@/lib/types';
import { MARKETPLACE_CONFIGS, type MarketplaceFieldKey } from './marketplace-config';

export interface MarketplaceSubmitPayload {
  fields: Partial<Record<MarketplaceFieldKey, string>>;
  cookie: string;
}

function initialFieldValue(key: MarketplaceFieldKey, connection?: MarketplaceConnection): string {
  switch (key) {
    case 'appId':
      return connection?.appId ?? '';
    case 'affiliateTag':
      return connection?.affiliateTag ?? '';
    case 'mattWord':
      return connection?.mattWord ?? '';
    case 'mattTool':
      return connection?.mattTool ?? '';
    case 'secret':
      return '';
  }
}

function sessionStatus(kind: MarketplaceKind, connection?: MarketplaceConnection) {
  if (!connection) return null;
  const syncedAt =
    kind === 'MERCADOLIVRE'
      ? connection.mlSessionSyncedAt
      : kind === 'AMAZON'
        ? connection.amazonSessionSyncedAt
        : kind === 'MAGALU'
          ? connection.magaluSessionSyncedAt
          : null;
  const source =
    kind === 'MERCADOLIVRE'
      ? connection.mlSessionSource
      : kind === 'AMAZON'
        ? connection.amazonSessionSource
        : kind === 'MAGALU'
          ? connection.magaluSessionSource
          : null;
  if (!syncedAt) return null;
  return { syncedAt, source };
}

export function MarketplaceDrawer({
  kind,
  connection,
  open,
  onOpenChange,
  onSubmit,
  pending,
  feedback,
}: {
  kind: MarketplaceKind;
  connection?: MarketplaceConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: MarketplaceSubmitPayload) => Promise<void>;
  pending: boolean;
  feedback: string | null;
}) {
  const config = MARKETPLACE_CONFIGS[kind];
  const [values, setValues] = useState<Record<string, string>>({});
  const [cookie, setCookie] = useState('');

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const field of config.fields) initial[field.key] = initialFieldValue(field.key, connection);
    setValues(initial);
    setCookie('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  const session = sessionStatus(kind, connection);
  const status = connection?.status ?? 'UNCONFIGURED';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fields: Partial<Record<MarketplaceFieldKey, string>> = {};
    for (const field of config.fields) {
      const value = values[field.key]?.trim();
      if (value) fields[field.key] = value;
    }
    await onSubmit({ fields, cookie: cookie.trim() });
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center justify-between gap-2">
            <DrawerTitle>{config.label}</DrawerTitle>
            <StatusPill label={status} status={status} />
          </div>
          <DrawerDescription>{config.description}</DrawerDescription>
          <a
            href={config.platformUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-xs text-brand underline"
          >
            Abrir plataforma
          </a>
        </DrawerHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4">
          {config.fields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`mkt-${field.key}`}>
                {field.label}
                {field.required && <span className="text-red-400"> *</span>}
              </Label>
              <Input
                id={`mkt-${field.key}`}
                type={field.type}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                placeholder={
                  field.key === 'secret'
                    ? connection?.hasSecret
                      ? '•••• (já salvo)'
                      : ''
                    : field.placeholder
                }
                className="mt-1"
              />
              {field.helpContent && (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    {field.helpTitle ?? 'Ajuda'}
                  </summary>
                  <p className="mt-1">{field.helpContent}</p>
                </details>
              )}
            </div>
          ))}

          {config.supportsSession && (
            <div className="rounded-lg border border-border bg-surface-2 p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Sessão logada (opcional)</p>
                {session ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">
                    Sincronizada em {formatDateTime(session.syncedAt)} (
                    {session.source === 'manual' ? 'manual' : 'extensão'})
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Não sincronizada
                  </span>
                )}
              </div>
              <Label htmlFor="mkt-cookie">
                Cole aqui o valor do cookie{' '}
                {config.sessionCookieName ? `"${config.sessionCookieName}"` : ''} ou a string
                completa...
              </Label>
              <Textarea
                id="mkt-cookie"
                aria-label="Cookie de sessão"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="Ex: nome=valor; outro=valor"
                className="mt-1"
              />
              {config.sessionHelpContent && (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    {config.sessionHelpTitle ?? 'Como exportar o cookie?'}
                  </summary>
                  <p className="mt-1">{config.sessionHelpContent}</p>
                </details>
              )}
              {config.extensionUrl && (
                <p className="mt-2 text-xs">
                  Ou instale a{' '}
                  <a href={config.extensionUrl} className="text-brand underline">
                    extensão Afilados Connect
                  </a>{' '}
                  para sincronizar automaticamente.
                </p>
              )}
            </div>
          )}

          {feedback && (
            <p
              className={`text-xs ${feedback.toLowerCase().includes('sucesso') || feedback.toLowerCase().includes('valid') ? 'text-emerald-500' : 'text-red-400'}`}
            >
              {feedback}
            </p>
          )}

          <DrawerFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Testando e salvando...' : 'Testar e Salvar'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `pnpm --filter @afilados/web test -- marketplace-drawer`
Expected: PASS (3 casos)

- [ ] **Step 5: Rodar o typecheck do web**

Run: `pnpm --filter @afilados/web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/marketplaces/marketplace-drawer.tsx apps/web/test/marketplace-drawer.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): componente MarketplaceDrawer genérico

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Página `/marketplaces`, redirects das rotas antigas, sidebar e limpeza

**Files:**
- Create: `apps/web/src/app/(app)/marketplaces/page.tsx`
- Modify: `apps/web/src/app/(app)/config/shopee/page.tsx` (vira redirect)
- Modify: `apps/web/src/app/(app)/config/mercadolivre/page.tsx` (vira redirect)
- Modify: `apps/web/src/app/(app)/config/amazon/page.tsx` (vira redirect)
- Modify: `apps/web/src/app/(app)/config/magalu/page.tsx` (vira redirect)
- Modify: `apps/web/src/components/app-shell/sidebar.tsx:35-45`
- Modify: `apps/web/src/app/(app)/page.tsx:40` (link do card Shopee)
- Delete: `apps/web/src/components/settings/tag-connection-form.tsx` (substituído pelo `MarketplaceDrawer`; confirmado que só era usado pelas 3 páginas que agora viram redirect — ver Step 3)

**Interfaces:**
- Consumes: `MARKETPLACE_KINDS` de `@afilados/shared`; `useMarketplaces` de `@/lib/queries`; `apiFetch` de `@/lib/api`; `MARKETPLACE_CONFIGS` (Task 5); `MarketplaceDrawer`, `MarketplaceSubmitPayload` (Task 6).
- Produces: rota `/marketplaces` navegável pela sidebar; nenhuma interface nova consumida por outras tasks (é a última peça de integração).

- [ ] **Step 1: Criar a página de lista `/marketplaces`**

Crie `apps/web/src/app/(app)/marketplaces/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/app-shell/status-pill';
import { apiFetch } from '@/lib/api';
import { useMarketplaces } from '@/lib/queries';
import {
  MarketplaceDrawer,
  type MarketplaceSubmitPayload,
} from '@/components/marketplaces/marketplace-drawer';
import { MARKETPLACE_CONFIGS } from '@/components/marketplaces/marketplace-config';
import type { MarketplaceConnection } from '@/lib/types';

export default function MarketplacesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: marketplaces = [], refetch } = useMarketplaces();
  const openKind = searchParams.get('open') as MarketplaceKind | null;
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  function openDrawer(kind: MarketplaceKind) {
    setFeedback(null);
    router.replace(`/marketplaces?open=${kind}`);
  }
  function closeDrawer() {
    router.replace('/marketplaces');
  }

  async function handleSubmit(kind: MarketplaceKind, payload: MarketplaceSubmitPayload) {
    setPending(true);
    setFeedback(null);
    try {
      if (Object.keys(payload.fields).length > 0) {
        await apiFetch(`/marketplaces/${kind}`, { method: 'PUT', json: payload.fields });
      }
      if (payload.cookie) {
        await apiFetch(`/marketplaces/${kind}/session`, {
          method: 'POST',
          json: { cookie: payload.cookie },
        });
      }
      const result = await apiFetch<MarketplaceConnection>(`/marketplaces/${kind}/check`, {
        method: 'POST',
      });
      setFeedback(
        result.status === 'OK'
          ? 'Conexão validada com sucesso!'
          : (result.lastError ?? 'Falha na validação das credenciais.'),
      );
      await refetch();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Falha ao salvar/testar a conexão.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marketplaces</h1>
        <p className="text-sm text-muted-foreground">Configure suas credenciais de afiliado.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MARKETPLACE_KINDS.map((kind) => {
          const conn = marketplaces.find((m) => m.kind === kind);
          const config = MARKETPLACE_CONFIGS[kind];
          const status = conn?.status ?? 'UNCONFIGURED';
          return (
            <div key={kind} className="rounded-xl border border-border bg-card p-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-semibold">{config.label}</h2>
                <StatusPill label={status} status={status} />
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{config.description}</p>
              <Button variant="outline" onClick={() => openDrawer(kind)}>
                Configurar marketplace
              </Button>
            </div>
          );
        })}
      </div>

      {openKind && MARKETPLACE_KINDS.includes(openKind) && (
        <MarketplaceDrawer
          kind={openKind}
          connection={marketplaces.find((m) => m.kind === openKind)}
          open
          onOpenChange={(v) => {
            if (!v) closeDrawer();
          }}
          onSubmit={(payload) => handleSubmit(openKind, payload)}
          pending={pending}
          feedback={feedback}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Transformar as 4 páginas antigas em redirects**

Substitua o conteúdo de `apps/web/src/app/(app)/config/shopee/page.tsx` por:

```tsx
import { redirect } from 'next/navigation';

export default function ShopeeConfigRedirect() {
  redirect('/marketplaces?open=SHOPEE');
}
```

Substitua o conteúdo de `apps/web/src/app/(app)/config/mercadolivre/page.tsx` por:

```tsx
import { redirect } from 'next/navigation';

export default function MercadoLivreConfigRedirect() {
  redirect('/marketplaces?open=MERCADOLIVRE');
}
```

Substitua o conteúdo de `apps/web/src/app/(app)/config/amazon/page.tsx` por:

```tsx
import { redirect } from 'next/navigation';

export default function AmazonConfigRedirect() {
  redirect('/marketplaces?open=AMAZON');
}
```

Substitua o conteúdo de `apps/web/src/app/(app)/config/magalu/page.tsx` por:

```tsx
import { redirect } from 'next/navigation';

export default function MagaluConfigRedirect() {
  redirect('/marketplaces?open=MAGALU');
}
```

- [ ] **Step 3: Remover o componente `TagConnectionForm`, agora sem uso**

Confirme que, após o Step 2, as únicas 3 referências restantes a `TagConnectionForm` (fora do próprio arquivo) já foram removidas junto com o conteúdo antigo das páginas:

Run: `grep -rn "TagConnectionForm" apps/web/src`
Expected: apenas `apps/web/src/components/settings/tag-connection-form.tsx` (o próprio arquivo)

Delete o arquivo `apps/web/src/components/settings/tag-connection-form.tsx`.

Rode de novo para confirmar:

Run: `grep -rn "TagConnectionForm" apps/web/src`
Expected: nenhum resultado (saída vazia)

- [ ] **Step 4: Atualizar a sidebar**

Em `apps/web/src/components/app-shell/sidebar.tsx`, troque as 4 linhas de marketplace no array `CONFIG` (linhas 39-42):

```ts
  { href: '/config/shopee', label: 'API Shopee', icon: ShoppingBag },
  { href: '/config/mercadolivre', label: 'Conexão Mercado Livre', icon: Store },
  { href: '/config/amazon', label: 'Conexão Amazon', icon: Tag },
  { href: '/config/magalu', label: 'Conexão Magalu', icon: Store },
```

por uma única linha:

```ts
  { href: '/marketplaces', label: 'Marketplaces', icon: Store },
```

O array `CONFIG` final fica:

```ts
const CONFIG = [
  { href: '/config/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { href: '/config/templates', label: 'Template das mensagens', icon: Bot },
  { href: '/config/cupons', label: 'Central de Cupons', icon: Ticket },
  { href: '/marketplaces', label: 'Marketplaces', icon: Store },
  { href: '/config/extensao', label: 'Extensão Chrome', icon: Sparkles },
  { href: '/config/conta', label: 'Minha Conta', icon: User },
];
```

Remova também do import de `lucide-react` no topo do arquivo os ícones que ficaram sem uso (`ShoppingBag`, `Tag`), mantendo os demais (`Store`, `Sparkles`, `User`, etc.).

- [ ] **Step 5: Atualizar o link do card Shopee na home**

Em `apps/web/src/app/(app)/page.tsx:40`, troque:

```tsx
          <Link href="/config/shopee" className="ml-2 text-xs text-brand underline">
```

por:

```tsx
          <Link href="/marketplaces?open=SHOPEE" className="ml-2 text-xs text-brand underline">
```

- [ ] **Step 6: Rodar o typecheck, lint e os testes do web**

Run: `pnpm --filter @afilados/web typecheck && pnpm --filter @afilados/web test`
Expected: PASS — nenhuma referência quebrada a `TagConnectionForm`, nenhum import não usado, todos os testes (incluindo os novos da Task 6) passam

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(app\)/marketplaces/page.tsx apps/web/src/app/\(app\)/config/shopee/page.tsx apps/web/src/app/\(app\)/config/mercadolivre/page.tsx apps/web/src/app/\(app\)/config/amazon/page.tsx apps/web/src/app/\(app\)/config/magalu/page.tsx apps/web/src/components/app-shell/sidebar.tsx apps/web/src/app/\(app\)/page.tsx
git rm apps/web/src/components/settings/tag-connection-form.tsx
git commit -m "$(cat <<'EOF'
feat(web): tela unificada /marketplaces com drawer de configuração

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verificação manual end-to-end no navegador

**Files:** nenhum arquivo novo — só verificação.

**Interfaces:**
- Consumes: toda a stack das Tasks 1-7 rodando de ponta a ponta (API + web + banco local).

- [ ] **Step 1: Subir o ambiente de desenvolvimento**

Garanta `APP_ENCRYPTION_KEY` setado no `.env` da API (`openssl rand -hex 32` se ainda não existir) e rode:

```bash
pnpm dev
```

- [ ] **Step 2: Verificar a lista de marketplaces**

Abra a URL local do app logado e navegue até "Marketplaces" na sidebar. Confirme que os 4 cards (Shopee, Mercado Livre, Amazon, Magalu) aparecem com status "NÃO CONFIGURADO".

- [ ] **Step 3: Testar o fluxo completo do Mercado Livre**

Clique em "Configurar marketplace" no card do Mercado Livre. Preencha `matt_word`/`matt_tool`, cole um valor qualquer no campo de cookie (ex.: `MELI_SESSION=teste123`), clique em "Testar e Salvar". Confirme que o status muda para OK, que o bloco de sessão mostra "Sincronizada em ... (manual)", e que o card na lista atualiza para "CONECTADO".

- [ ] **Step 4: Testar Amazon e Magalu com e sem cookie**

Repita para Amazon e Magalu: salvar só a tag (sem cookie) deve funcionar como antes; salvar tag + cookie deve marcar a sessão como sincronizada também.

- [ ] **Step 5: Confirmar que a Shopee não mudou de comportamento**

Abra o drawer da Shopee, confirme que não há campo de cookie, que o placeholder do secret mostra "•••• (já salvo)" após salvar uma vez, e que "Testar e Salvar" continua funcionando (em modo mock, retorna OK — comportamento pré-existente, fora de escopo desta entrega).

- [ ] **Step 6: Confirmar os redirects**

Acesse diretamente `/config/shopee`, `/config/mercadolivre`, `/config/amazon`, `/config/magalu` na URL e confirme que cada um redireciona para `/marketplaces?open=<KIND>` abrindo o drawer certo.

- [ ] **Step 7: Rodar a suíte completa do monorepo antes de finalizar**

Run: `pnpm test && pnpm typecheck`
Expected: PASS em todos os pacotes (`@afilados/shared`, `@afilados/api`, `@afilados/web`, e os demais não tocados por este plano)
