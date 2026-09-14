# F1-C — Web (Next.js) + Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o painel web (`apps/web`, Next.js) com todas as telas da Fase 1 consumindo a API da F1-B, mais o empacotamento de produção (Docker + Caddy + `deploy.sh`) para o VPS do dono.

**Architecture:** SPA em Next.js 15 (App Router) com Tailwind + shadcn/ui, tema escuro com acento `#14b8a6`. Em dev, `next.config.ts` reescreve `/api/*` para a API em `:3001` (same-origin, cookie funciona sem CORS); em produção o Caddy roteia `/api/*` direto para o container `api` e o resto para `web`. WebSocket vai direto ao endereço da API (`NEXT_PUBLIC_WS_URL`) — cookies não isolam por porta, e em produção o Caddy expõe `/api/v1/ws` no mesmo host. Estado de servidor com TanStack Query; eventos realtime invalidam queries. `apps/web` importa `@afilados/shared` (tipos/enums) e `@afilados/core` (funções puras, para pré-visualizar agendamento) — a regra de dependência da arquitetura é ampliada para `web → shared, core`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind 3, shadcn/ui, TanStack Query 5, `qrcode.react`, `lucide-react`, `sonner`, Vitest + Testing Library (unit), Playwright (E2E), Docker multi-stage (node:22-alpine), Caddy 2.

## Global Constraints

- Tema escuro obrigatório: fundo `#0b1220`/`#0f172a`, superfícies `#111a2e`, texto `#e2e8f0`, acento `#14b8a6` (teal), perigo `#ef4444`. Fonte Inter (via `next/font`).
- Sidebar (spec §4.3/§8): **Principal** — Visão Geral `/`, Dashboard & Métricas `/dashboard`, Buscar Produtos `/produtos`, Enviar Ofertas `/enviar`, Espelhamento `/espelhamento`, Gestor de Tráfego IA `/trafego`, Afiliados `/afiliados`; **Configurações** — WhatsApp `/config/whatsapp`, Template das mensagens `/config/templates`, Central de Cupons `/config/cupons`, API Shopee `/config/shopee`, Conexão Mercado Livre `/config/mercadolivre`, Conexão Amazon `/config/amazon`, Conexão Magalu `/config/magalu`, Minha Conta `/config/conta`. Rotas de fases futuras renderizam `<PhasePlaceholder phase="F2" />` etc.
- Topbar com pills de status: WhatsApp (por sessão), Shopee, Mercado Livre, Amazon, Magalu — verde `OK/CONNECTED`, amarelo `CONNECTING/NEEDS_QR`, cinza `UNCONFIGURED/DISCONNECTED`, vermelho `ERROR/LOGGED_OUT`.
- Toda chamada à API passa por `apiFetch<T>(path, init?)` (`src/lib/api.ts`): `credentials: 'include'`, JSON, lança `ApiClientError { code, message, status }` a partir do envelope `{ error: { code, message } }`; 401 fora de `/login` redireciona para `/login`.
- Textos da UI em português do Brasil. Nunca exibir `secret` de marketplace (API já devolve só `hasSecret`).
- Testes: unit (Vitest + Testing Library) para `api.ts`, `useRealtime`, `formatters` e componentes puros; E2E Playwright para login → template preview → busca (mock) → salvar na fila → criar lote (com sessão `CONNECTED` semeada via Prisma).
- Runtime de produção: `next build` + `next start` na imagem `web` (a web **tem** build, diferente de api/worker que usam tsx).
- TypeScript strict, ESM. Prettier antes de cada commit. Commits em português, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Todos os comandos assumem Git Bash na raiz; API/worker/Postgres/Redis rodando (`docker compose up -d --wait`, `pnpm dev`) para E2E.

## API consumida (referência — já existe em `apps/api`)

| Rota | Resposta |
|---|---|
| `POST /api/v1/auth/login {email,password}` → 204 + cookie · `POST /auth/logout` → 204 | |
| `GET /api/v1/me` | `{ user:{id,email,name,role}, tenant:{id,name} }` |
| `GET/PUT /api/v1/settings` | `{ window:{startTime,endTime,timezone,enabled}, queueLimit, globalRateLimitPerMin, subIdPattern }` |
| `GET /api/v1/wa/sessions` · `POST {label}` · `DELETE /:id` · `POST /:id/connect {mode,phone?}` · `/disconnect` · `/logout` · `/sync-groups` · `GET /:id/groups` | sessão: `{id,label,phone,status,lastQr,pairCode,lastSeenAt,createdAt}`; grupo: `{id,jid,name,kind,botIsAdmin,memberCount}` |
| `GET /api/v1/marketplaces` · `PUT /:kind {appId?,secret?,affiliateTag?}` · `POST /:kind/check` | `{kind,status,affiliateTag,appId,hasSecret,lastCheckedAt,lastError}` |
| `POST /api/v1/products/search` (body `SearchQuery`) | `{ products: ApiProduct[] }` |
| `POST /api/v1/products/import {urls}` ou multipart `file` | `{ products, unsupported:{url,reason}[] }` |
| `GET /api/v1/queue` · `POST {productIds}` → 201 `{added,count}` · `POST /select {ids,selected}` · `DELETE /:id` · `DELETE ?status=SENT` | `{ items:(QueueItem&{product})[], limit, count }` |
| `GET/POST/PUT/DELETE /api/v1/templates` · `POST /templates/preview {body}` → `{text}` | `{id,name,body,isDefault}` |
| `GET/POST /api/v1/batches` · `GET /:id` · `POST /:id/pause|resume|cancel` | lista: `{id,name,status,intervalMin,mediaMode,estimatedEndAt,createdAt,total,sent,errors}` |
| `GET /api/v1/overview` | `{ wa:[{id,label,status,phone}], shopee, queue:{count,limit}, batches:[{id,name,status,estimatedEndAt,total,sent}], errors: SendLog[] }` |
| `WS /api/v1/ws` | `RealtimeEvent` (de `@afilados/shared`) |

## File Structure

```
apps/web/
  package.json, tsconfig.json, next.config.ts, tailwind.config.ts, postcss.config.mjs, components.json
  vitest.config.ts, vitest.setup.ts, playwright.config.ts
  .env.example                      NEXT_PUBLIC_WS_URL, API_INTERNAL_URL
  src/app/layout.tsx                html/body, fonte, Providers
  src/app/providers.tsx             QueryClientProvider + Toaster
  src/app/globals.css               tokens do tema
  src/app/login/page.tsx
  src/app/(app)/layout.tsx          AppShell (sidebar + topbar) + RealtimeProvider
  src/app/(app)/page.tsx            Visão Geral
  src/app/(app)/produtos/page.tsx
  src/app/(app)/enviar/page.tsx
  src/app/(app)/config/whatsapp/page.tsx
  src/app/(app)/config/templates/page.tsx
  src/app/(app)/config/shopee/page.tsx
  src/app/(app)/config/conta/page.tsx
  src/app/(app)/{dashboard,espelhamento,trafego,afiliados}/page.tsx           placeholders
  src/app/(app)/config/{cupons,mercadolivre,amazon,magalu}/page.tsx           placeholders
  src/middleware.ts                 redireciona para /login sem cookie
  src/lib/api.ts                    apiFetch + ApiClientError + WS_URL
  src/lib/types.ts                  tipos das respostas (tabela acima)
  src/lib/format.ts                 formatBRL, formatDateTime, statusTone
  src/lib/queries.ts                hooks TanStack por recurso
  src/lib/realtime.tsx              RealtimeProvider + useRealtime + createRealtimeClient
  src/components/ui/*               shadcn (gerados)
  src/components/app-shell/{sidebar,topbar,status-pill}.tsx
  src/components/phase-placeholder.tsx
  src/components/products/{search-filters,product-card,import-panel}.tsx
  src/components/queue/{queue-table,batch-form,batch-list}.tsx
  src/components/whatsapp/{session-card,groups-list}.tsx
  src/components/templates/template-editor.tsx
  test/*.test.ts(x)                 unit
  e2e/*.spec.ts, e2e/seed.ts        Playwright
deploy/
  Dockerfile.api, Dockerfile.worker, Dockerfile.web, Caddyfile
docker-compose.prod.yml
deploy.sh
```

---

### Task 1: Scaffold do `apps/web`, tema, cliente de API e proxy

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `.env.example`, `vitest.config.ts`, `vitest.setup.ts`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/providers.tsx`, `src/app/page.tsx` (temporário)
- Create: `src/lib/api.ts`, `src/lib/types.ts`, `src/lib/format.ts`
- Test: `apps/web/test/api.test.ts`, `apps/web/test/format.test.ts`

**Interfaces:**
- Produces:
  - `apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T>` — prefixa `/api/v1`, `credentials: 'include'`, serializa `json`, `204` → `undefined as T`; erro → `throw new ApiClientError(code, message, status)`; em 401 com `window.location.pathname !== '/login'` faz `window.location.assign('/login')`.
  - `class ApiClientError extends Error { code: string; status: number }`.
  - `WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/api/v1/ws'`.
  - `types.ts`: `Me`, `Settings`, `WaSession`, `WaGroup`, `MarketplaceConnection`, `ApiProduct`, `QueueItem`, `QueueResponse`, `Template`, `BatchSummary`, `BatchItem`, `BatchDetail`, `Overview`.
  - `format.ts`: `formatBRL(n: number | null | undefined): string`, `formatDateTime(iso): string` (pt-BR, `America/Sao_Paulo`), `statusTone(status: string): 'ok'|'warn'|'muted'|'error'`.

- [ ] **Step 1: Criar o app**

Run (na raiz):
```bash
pnpm dlx create-next-app@15 apps/web --ts --tailwind --app --src-dir --eslint --import-alias "@/*" --use-pnpm --no-git --turbopack
```
Ajustar `apps/web/package.json`: `"name": "@afilados/web"`; dependências `@afilados/shared: workspace:*`, `@afilados/core: workspace:*`, `@tanstack/react-query: ^5.59.0`, `qrcode.react: ^4.0.1`, `lucide-react: ^0.447.0`, `sonner: ^1.5.0`; devDeps `vitest: ^2.1.1`, `@vitejs/plugin-react: ^4.3.2`, `@testing-library/react: ^16.0.1`, `@testing-library/jest-dom: ^6.5.0`, `jsdom: ^25.0.1`, `@playwright/test: ^1.47.0`. Scripts: `"dev": "next dev -p 3000"`, `"build": "next build"`, `"start": "next start -p 3000"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`, `"e2e": "playwright test"`. Rodar `pnpm install`.

- [ ] **Step 2: shadcn**

Run: `cd apps/web && pnpm dlx shadcn@latest init -d && pnpm dlx shadcn@latest add button card input label table tabs badge dialog switch select checkbox textarea separator scroll-area tooltip skeleton`
Expected: `components.json`, `src/lib/utils.ts` (`cn`) e `src/components/ui/*` criados.

- [ ] **Step 3: `next.config.ts` e `.env.example`**

```ts
import type { NextConfig } from 'next';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@afilados/shared', '@afilados/core'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};
export default nextConfig;
```

`apps/web/.env.example`:
```
NEXT_PUBLIC_WS_URL=ws://localhost:3001/api/v1/ws
API_INTERNAL_URL=http://localhost:3001
```

- [ ] **Step 4: Tema — `globals.css` e `tailwind.config.ts`**

`src/app/globals.css` (substituir o gerado, mantendo as variáveis que o shadcn adicionar abaixo):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 222 47% 8%;
  --surface: 222 40% 12%;
  --surface-2: 222 35% 16%;
  --foreground: 214 32% 91%;
  --muted: 215 16% 57%;
  --accent: 173 80% 40%;
  --accent-foreground: 0 0% 100%;
  --danger: 0 84% 60%;
  --warn: 38 92% 50%;
  --border: 217 25% 22%;
  --radius: 0.75rem;
}
body {
  @apply bg-[hsl(var(--background))] text-[hsl(var(--foreground))] antialiased;
}
```

`tailwind.config.ts` — em `theme.extend.colors` acrescentar:
```ts
background: 'hsl(var(--background))',
surface: 'hsl(var(--surface))',
'surface-2': 'hsl(var(--surface-2))',
foreground: 'hsl(var(--foreground))',
muted: 'hsl(var(--muted))',
accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
danger: 'hsl(var(--danger))',
warn: 'hsl(var(--warn))',
border: 'hsl(var(--border))',
```

- [ ] **Step 5: Config de testes e testes**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['test/**/*.test.{ts,tsx}'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
```
`vitest.setup.ts`: `import '@testing-library/jest-dom/vitest';`

`test/api.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiClientError } from '@/lib/api';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

describe('apiFetch', () => {
  it('prefixa /api/v1, envia JSON e cookies', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const r = await apiFetch<{ ok: boolean }>('/health', { method: 'POST', json: { a: 1 } });
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/health');
    expect(init.credentials).toBe('include');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });
  it('204 devolve undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await apiFetch('/auth/logout', { method: 'POST' })).toBeUndefined();
  });
  it('erro vira ApiClientError com code/status', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'QUEUE_FULL', message: 'Fila cheia' } }), { status: 400 }),
    );
    await expect(apiFetch('/queue', { method: 'POST', json: {} })).rejects.toMatchObject({
      name: 'ApiClientError', code: 'QUEUE_FULL', message: 'Fila cheia', status: 400,
    });
  });
  it('401 fora do /login redireciona', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname: '/produtos', assign });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401 }),
    );
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiClientError);
    expect(assign).toHaveBeenCalledWith('/login');
  });
});
```

`test/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatBRL, statusTone } from '@/lib/format';

describe('format', () => {
  it('formatBRL', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
    expect(formatBRL(null)).toBe('—');
  });
  it('statusTone', () => {
    expect(statusTone('CONNECTED')).toBe('ok');
    expect(statusTone('OK')).toBe('ok');
    expect(statusTone('NEEDS_QR')).toBe('warn');
    expect(statusTone('CONNECTING')).toBe('warn');
    expect(statusTone('ERROR')).toBe('error');
    expect(statusTone('LOGGED_OUT')).toBe('error');
    expect(statusTone('UNCONFIGURED')).toBe('muted');
  });
});
```

- [ ] **Step 6: Rodar para ver falhar**

Run: `pnpm --filter @afilados/web test`
Expected: FAIL — `@/lib/api` / `@/lib/format` inexistentes.

- [ ] **Step 7: Implementar `src/lib/api.ts`, `src/lib/format.ts`, `src/lib/types.ts`**

`src/lib/api.ts`:
```ts
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/api/v1/ws';

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

export async function apiFetch<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const h: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
  let body = rest.body;
  if (json !== undefined) {
    h['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(`/api/v1${path}`, { ...rest, body, headers: h, credentials: 'include' });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    const code = data?.error?.code ?? 'INTERNAL';
    const message = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    throw new ApiClientError(code, message, res.status);
  }
  return data as T;
}
```

`src/lib/format.ts`:
```ts
export function formatBRL(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export type Tone = 'ok' | 'warn' | 'muted' | 'error';
export function statusTone(status: string): Tone {
  switch (status) {
    case 'CONNECTED':
    case 'OK':
    case 'SENT':
    case 'DONE':
      return 'ok';
    case 'CONNECTING':
    case 'NEEDS_QR':
    case 'RUNNING':
    case 'SCHEDULED':
    case 'PAUSED':
    case 'SENDING':
    case 'PENDING':
      return 'warn';
    case 'ERROR':
    case 'LOGGED_OUT':
    case 'CANCELLED':
      return 'error';
    default:
      return 'muted';
  }
}
```

`src/lib/types.ts`:
```ts
import type { MarketplaceKind, MediaMode, WaSessionStatus, BatchStatus, BatchItemStatus } from '@afilados/shared';

export interface Me {
  user: { id: string; email: string; name: string; role: string };
  tenant: { id: string; name: string };
}
export interface Settings {
  window: { startTime: string; endTime: string; timezone: string; enabled: boolean };
  queueLimit: number;
  globalRateLimitPerMin: number;
  subIdPattern: string;
}
export interface WaSession {
  id: string; label: string; phone: string | null; status: WaSessionStatus;
  lastQr: string | null; pairCode: string | null; lastSeenAt: string | null; createdAt: string;
}
export interface WaGroup { id: string; jid: string; name: string; kind: 'GROUP' | 'COMMUNITY' | 'CHANNEL'; botIsAdmin: boolean; memberCount: number }
export interface MarketplaceConnection {
  kind: MarketplaceKind; status: 'UNCONFIGURED' | 'OK' | 'ERROR'; affiliateTag: string | null;
  appId: string | null; hasSecret: boolean; lastCheckedAt: string | null; lastError: string | null;
}
export interface ApiProduct {
  id: string; source: string; externalId: string | null; title: string; price: number; originalPrice: number | null;
  discountPct: number | null; salesCount: number | null; commissionPct: number | null; images: string[];
  shipping: string; flashSaleEndsAt: string | null; couponCode: string | null; originalUrl: string;
  shopId: string | null; shopName: string | null;
}
export interface QueueItem { id: string; productId: string; selected: boolean; status: 'PENDING' | 'SENT' | 'ERROR'; addedAt: string; product: ApiProduct }
export interface QueueResponse { items: QueueItem[]; limit: number; count: number }
export interface Template { id: string; name: string; body: string; isDefault: boolean }
export interface BatchSummary {
  id: string; name: string; status: BatchStatus; intervalMin: number; mediaMode: MediaMode; shuffled: boolean;
  groupJids: string[]; estimatedEndAt: string | null; createdAt: string; total: number; sent: number; errors: number;
}
export interface BatchItem { id: string; order: number; runAt: string; status: BatchItemStatus; error: string | null; product: ApiProduct }
export interface BatchDetail extends Omit<BatchSummary, 'total' | 'sent' | 'errors'> { items: BatchItem[] }
export interface Overview {
  wa: { id: string; label: string; status: WaSessionStatus; phone: string | null }[];
  shopee: 'UNCONFIGURED' | 'OK' | 'ERROR';
  queue: { count: number; limit: number };
  batches: { id: string; name: string; status: BatchStatus; estimatedEndAt: string | null; total: number; sent: number }[];
  errors: { id: string; groupJid: string; error: string | null; sentAt: string }[];
}
```

- [ ] **Step 8: `layout.tsx`, `providers.tsx`, página temporária**

`src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });
export const metadata: Metadata = { title: 'Afilados', description: 'Automação de ofertas para grupos de WhatsApp' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

`src/app/providers.tsx`:
```tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster theme="dark" richColors position="top-right" />
    </QueryClientProvider>
  );
}
```

`src/app/page.tsx` temporário:
```tsx
export default function Page() {
  return <main className="p-6">ok</main>;
}
```

- [ ] **Step 9: Rodar testes, typecheck, build e commitar**

Run: `pnpm --filter @afilados/web test && pnpm --filter @afilados/web typecheck && pnpm --filter @afilados/web build`
Expected: 6 testes PASS; typecheck e build sem erros.

```bash
pnpm format && git add apps/web pnpm-lock.yaml && git commit -m "feat(web): scaffold Next.js com tema, cliente de API, tipos e proxy dev

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shell do app — sidebar, topbar com pills, guarda de auth, realtime, login

**Files:**
- Create: `src/middleware.ts`, `src/lib/queries.ts`, `src/lib/realtime.tsx`
- Create: `src/components/app-shell/{sidebar,topbar,status-pill}.tsx`, `src/components/phase-placeholder.tsx`
- Create: `src/app/login/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx` (versão inicial; refinada na Task 7)
- Create: placeholders `src/app/(app)/{dashboard,espelhamento,trafego,afiliados}/page.tsx`, `src/app/(app)/config/{cupons,mercadolivre,amazon,magalu}/page.tsx`
- Delete: `src/app/page.tsx` temporário
- Test: `test/realtime.test.tsx`, `test/status-pill.test.tsx`

**Interfaces:**
- Produces:
  - `queries.ts`: `useMe()`, `useOverview()`, `useSettings()`, `useSessions()`, `useGroups(sessionId: string | null)`, `useMarketplaces()`, `useQueue()`, `useTemplates()`, `useBatches()`, `useBatch(id: string | null)` — `queryKey`s: `['me']`, `['overview']`, `['settings']`, `['wa','sessions']`, `['wa','groups',sessionId]`, `['marketplaces']`, `['queue']`, `['templates']`, `['batches']`, `['batches',id]`.
  - `realtime.tsx`: `createRealtimeClient(url, onEvent, WS = WebSocket): { stop(): void }` (reconecta com backoff 1s→30s); `RealtimeProvider` (invalida `['wa']`+`['overview']` em `wa.*`; `['batches']`+`['queue']`+`['overview']` em `batch.*`); `useRealtime(handler)`.
  - `StatusPill({ label, status, title? })` com atributo `data-tone`; `Sidebar()`; `Topbar()`; `PhasePlaceholder({ title, phase })`.
  - `middleware.ts`: sem cookie `afilados_session` fora de `/login` → redirect `/login`; com cookie em `/login` → redirect `/`.

- [ ] **Step 1: Testes**

`test/realtime.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { createRealtimeClient } from '@/lib/realtime';

class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('createRealtimeClient', () => {
  it('entrega eventos parseados e reconecta ao fechar', () => {
    vi.useFakeTimers();
    FakeWS.instances = [];
    const onEvent = vi.fn();
    const client = createRealtimeClient('ws://x', onEvent, FakeWS as unknown as typeof WebSocket);
    expect(FakeWS.instances).toHaveLength(1);
    const ws = FakeWS.instances[0]!;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ type: 'wa.status', sessionId: 's', status: 'CONNECTED' }) });
    expect(onEvent).toHaveBeenCalledWith({ type: 'wa.status', sessionId: 's', status: 'CONNECTED' });
    ws.onmessage?.({ data: 'lixo' });
    expect(onEvent).toHaveBeenCalledTimes(1);
    ws.onclose?.();
    vi.advanceTimersByTime(1000);
    expect(FakeWS.instances).toHaveLength(2);
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});
```

`test/status-pill.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/app-shell/status-pill';

describe('StatusPill', () => {
  it('mostra label e tom pelo status', () => {
    render(<StatusPill label="Shopee" status="OK" />);
    expect(screen.getByText('Shopee').closest('[data-tone]')).toHaveAttribute('data-tone', 'ok');
  });
  it('status desconhecido é muted', () => {
    render(<StatusPill label="Magalu" status="UNCONFIGURED" />);
    expect(screen.getByText('Magalu').closest('[data-tone]')).toHaveAttribute('data-tone', 'muted');
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/web test`
Expected: FAIL nos dois arquivos novos.

- [ ] **Step 3: Implementar `src/lib/realtime.tsx`**

```tsx
'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@afilados/shared';
import { WS_URL } from './api';

type Handler = (e: RealtimeEvent) => void;

export function createRealtimeClient(url: string, onEvent: Handler, WS: typeof WebSocket = WebSocket) {
  let stopped = false;
  let attempt = 0;
  let ws: WebSocket | null = null;
  const open = () => {
    if (stopped) return;
    ws = new WS(url);
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as RealtimeEvent);
      } catch {
        /* mensagem inválida: ignora */
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
      setTimeout(open, delay);
    };
  };
  open();
  return {
    stop() {
      stopped = true;
      ws?.close();
    },
  };
}

const Ctx = createContext<{ subscribe: (h: Handler) => () => void } | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const handlers = useRef(new Set<Handler>());
  useEffect(() => {
    const client = createRealtimeClient(WS_URL, (e) => {
      if (e.type.startsWith('wa.')) {
        void qc.invalidateQueries({ queryKey: ['wa'] });
        void qc.invalidateQueries({ queryKey: ['overview'] });
      }
      if (e.type.startsWith('batch.')) {
        void qc.invalidateQueries({ queryKey: ['batches'] });
        void qc.invalidateQueries({ queryKey: ['queue'] });
        void qc.invalidateQueries({ queryKey: ['overview'] });
      }
      handlers.current.forEach((h) => h(e));
    });
    return () => client.stop();
  }, [qc]);
  const subscribe = (h: Handler) => {
    handlers.current.add(h);
    return () => {
      handlers.current.delete(h);
    };
  };
  return <Ctx.Provider value={{ subscribe }}>{children}</Ctx.Provider>;
}

export function useRealtime(handler: Handler) {
  const ctx = useContext(Ctx);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => ctx?.subscribe((e) => ref.current(e)), [ctx]);
}
```

- [ ] **Step 4: Implementar `src/lib/queries.ts`**

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  BatchDetail, BatchSummary, MarketplaceConnection, Me, Overview, QueueResponse, Settings, Template, WaGroup, WaSession,
} from './types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') });
export const useOverview = () =>
  useQuery({ queryKey: ['overview'], queryFn: () => apiFetch<Overview>('/overview'), refetchInterval: 15_000 });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => apiFetch<Settings>('/settings') });
export const useSessions = () => useQuery({ queryKey: ['wa', 'sessions'], queryFn: () => apiFetch<WaSession[]>('/wa/sessions') });
export const useGroups = (sessionId: string | null) =>
  useQuery({
    queryKey: ['wa', 'groups', sessionId],
    enabled: !!sessionId,
    queryFn: () => apiFetch<WaGroup[]>(`/wa/sessions/${sessionId}/groups`),
  });
export const useMarketplaces = () =>
  useQuery({ queryKey: ['marketplaces'], queryFn: () => apiFetch<MarketplaceConnection[]>('/marketplaces') });
export const useQueue = () => useQuery({ queryKey: ['queue'], queryFn: () => apiFetch<QueueResponse>('/queue') });
export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => apiFetch<Template[]>('/templates') });
export const useBatches = () =>
  useQuery({ queryKey: ['batches'], queryFn: () => apiFetch<BatchSummary[]>('/batches'), refetchInterval: 10_000 });
export const useBatch = (id: string | null) =>
  useQuery({ queryKey: ['batches', id], enabled: !!id, queryFn: () => apiFetch<BatchDetail>(`/batches/${id}`) });
```

- [ ] **Step 5: Componentes do shell**

`src/components/app-shell/status-pill.tsx`:
```tsx
import { statusTone } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  muted: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  error: 'bg-red-500/15 text-red-300 border-red-500/40',
};

export function StatusPill({ label, status, title }: { label: string; status: string; title?: string }) {
  const tone = statusTone(status);
  return (
    <span
      data-tone={tone}
      title={title ?? status}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', TONE[tone])}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
```

`src/components/app-shell/sidebar.tsx`:
```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Bot, Home, LogOut, Megaphone, MessageSquare, Radio, Search, Send, Settings, ShoppingBag, Store, Tag, Ticket, User, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';

const PRINCIPAL = [
  { href: '/', label: 'Visão Geral', icon: Home },
  { href: '/dashboard', label: 'Dashboard & Métricas', icon: BarChart3 },
  { href: '/produtos', label: 'Buscar Produtos', icon: Search },
  { href: '/enviar', label: 'Enviar Ofertas', icon: Send },
  { href: '/espelhamento', label: 'Espelhamento', icon: Radio },
  { href: '/trafego', label: 'Gestor de Tráfego IA', icon: Megaphone },
  { href: '/afiliados', label: 'Afiliados', icon: Users },
];
const CONFIG = [
  { href: '/config/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { href: '/config/templates', label: 'Template das mensagens', icon: Bot },
  { href: '/config/cupons', label: 'Central de Cupons', icon: Ticket },
  { href: '/config/shopee', label: 'API Shopee', icon: ShoppingBag },
  { href: '/config/mercadolivre', label: 'Conexão Mercado Livre', icon: Store },
  { href: '/config/amazon', label: 'Conexão Amazon', icon: Tag },
  { href: '/config/magalu', label: 'Conexão Magalu', icon: Store },
  { href: '/config/conta', label: 'Minha Conta', icon: User },
];

function Group({ title, items, path }: { title: string; items: typeof PRINCIPAL; path: string }) {
  return (
    <div className="mb-4">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-2', active && 'bg-accent/15 text-accent')}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const path = usePathname();
  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface p-3">
      <div className="mb-4 flex items-center gap-2 px-3 text-lg font-bold">
        <Settings className="h-5 w-5 text-accent" /> Afilados
      </div>
      <nav className="flex-1 overflow-y-auto">
        <Group title="Principal" items={PRINCIPAL} path={path} />
        <Group title="Configurações" items={CONFIG} path={path} />
      </nav>
      <button onClick={logout} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-red-300 hover:bg-surface-2">
        <LogOut className="h-4 w-4" /> Sair
      </button>
    </aside>
  );
}
```

`src/components/app-shell/topbar.tsx`:
```tsx
'use client';
import { useMarketplaces, useSessions } from '@/lib/queries';
import { StatusPill } from './status-pill';

const LABEL: Record<string, string> = { SHOPEE: 'Shopee', MERCADOLIVRE: 'Mercado Livre', AMAZON: 'Amazon', MAGALU: 'Magalu' };

export function Topbar() {
  const { data: sessions } = useSessions();
  const { data: markets } = useMarketplaces();
  return (
    <header className="flex h-14 items-center justify-center gap-2 border-b border-border bg-surface/60 px-6">
      {(sessions ?? []).length === 0 && <StatusPill label="WhatsApp" status="DISCONNECTED" />}
      {(sessions ?? []).map((s) => <StatusPill key={s.id} label={`WhatsApp · ${s.label}`} status={s.status} />)}
      {(markets ?? []).map((m) => (
        <StatusPill key={m.kind} label={LABEL[m.kind] ?? m.kind} status={m.status} title={m.lastError ?? m.status} />
      ))}
    </header>
  );
}
```

`src/components/phase-placeholder.tsx`:
```tsx
export function PhasePlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="mb-2 text-xl font-semibold">{title}</h1>
      <p className="text-muted">Disponível na fase {phase}. Esta área será liberada nas próximas etapas do projeto.</p>
    </div>
  );
}
```

- [ ] **Step 6: Middleware, layout `(app)`, login, Visão Geral inicial e placeholders**

`src/middleware.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const has = req.cookies.has('afilados_session');
  const isLogin = req.nextUrl.pathname === '/login';
  if (!has && !isLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (has && isLogin) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next|favicon.ico).*)'] };
```

`src/app/(app)/layout.tsx`:
```tsx
import { Sidebar } from '@/components/app-shell/sidebar';
import { Topbar } from '@/components/app-shell/topbar';
import { RealtimeProvider } from '@/lib/realtime';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
```

`src/app/login/page.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/login', { method: 'POST', json: { email, password } });
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_hsl(173_80%_40%/0.15),_transparent_60%)]">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-xl">
        <h1 className="mb-1 text-2xl font-bold">Acessar Painel</h1>
        <p className="mb-6 text-sm text-muted">Entre com suas credenciais</p>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mb-4 mt-1" required />
        <Label htmlFor="password">Senha</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mb-6 mt-1" required />
        {error && (
          <p className="mb-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full bg-accent hover:bg-accent/90" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </main>
  );
}
```

`src/app/(app)/page.tsx` (versão inicial):
```tsx
'use client';
import { useOverview } from '@/lib/queries';

export default function OverviewPage() {
  const { data } = useOverview();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Visão Geral</h1>
      <pre className="mt-4 text-xs text-muted">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

Placeholders — um arquivo por rota, mesmo formato (exemplo `src/app/(app)/dashboard/page.tsx`):
```tsx
import { PhasePlaceholder } from '@/components/phase-placeholder';
export default function Page() {
  return <PhasePlaceholder title="Dashboard & Métricas" phase="F6" />;
}
```
Títulos/fases: `dashboard` → "Dashboard & Métricas" F6; `espelhamento` → "Espelhamento" F2; `trafego` → "Gestor de Tráfego IA" F7; `afiliados` → "Afiliados" F7; `config/cupons` → "Central de Cupons" F4; `config/mercadolivre` → "Conexão Mercado Livre" F3; `config/amazon` → "Conexão Amazon" F3; `config/magalu` → "Conexão Magalu" F3.

- [ ] **Step 7: Rodar, typecheck, build, verificação manual, commit**

Run: `pnpm --filter @afilados/web test && pnpm --filter @afilados/web typecheck && pnpm --filter @afilados/web build`
Expected: 9 testes PASS; build OK. Manual: com API rodando, `pnpm --filter @afilados/web dev`, abrir `http://localhost:3000` → redireciona para `/login`; logar com o usuário do seed → sidebar + pills + JSON da visão geral.

```bash
pnpm format && git add apps/web && git commit -m "feat(web): shell do painel com sidebar, pills de status, realtime, login e placeholders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Configurações → WhatsApp (sessões, QR/pair code, grupos)

**Files:**
- Create: `src/components/whatsapp/session-card.tsx`, `src/components/whatsapp/groups-list.tsx`, `src/app/(app)/config/whatsapp/page.tsx`
- Create: `src/lib/mutations.ts`
- Test: `test/session-card.test.tsx`

**Interfaces:**
- Produces:
  - `mutations.ts`: `useApiMutation<TIn, TOut>(fn: (input: TIn) => Promise<TOut>, opts?: { invalidate?: QueryKey[]; success?: string })` — `useMutation` que, em sucesso, invalida as keys e mostra `toast.success(success)`; em erro mostra `toast.error(err.message)`.
  - `SessionCard({ session, onConnect, onDisconnect, onLogout, onDelete, onSync })` — mostra label, telefone, `StatusPill`, e: em `NEEDS_QR` com `lastQr` renderiza `<QRCodeSVG value={lastQr} size={220} />`; com `pairCode` mostra o código em destaque (`font-mono text-3xl tracking-widest`); botões conforme status (DISCONNECTED/LOGGED_OUT → "Conectar (QR)" e "Conectar (código)"; CONNECTING/NEEDS_QR → "Cancelar"; CONNECTED → "Sincronizar grupos", "Desconectar", "Sair da conta"). "Conectar (código)" abre `Dialog` pedindo telefone (`55DDDNÚMERO`, dígitos).
  - `GroupsList({ sessionId })` — tabela: prefixo `[CANAL]`/`[COMUNIDADE]`/`[GRUPO]`, nome, membros, badge "Admin" quando `botIsAdmin`.

- [ ] **Step 1: Teste — `test/session-card.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCard } from '@/components/whatsapp/session-card';
import type { WaSession } from '@/lib/types';

const base: WaSession = {
  id: 's1', label: 'Chip 1', phone: null, status: 'DISCONNECTED', lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '2026-09-14T00:00:00Z',
};
const noop = { onConnect: vi.fn(), onDisconnect: vi.fn(), onLogout: vi.fn(), onDelete: vi.fn(), onSync: vi.fn() };

describe('SessionCard', () => {
  it('desconectada: oferece conectar por QR e por código', () => {
    render(<SessionCard session={base} {...noop} />);
    fireEvent.click(screen.getByRole('button', { name: /conectar \(qr\)/i }));
    expect(noop.onConnect).toHaveBeenCalledWith('s1', { mode: 'qr' });
    expect(screen.getByRole('button', { name: /conectar \(código\)/i })).toBeInTheDocument();
  });
  it('NEEDS_QR renderiza o QR', () => {
    render(<SessionCard session={{ ...base, status: 'NEEDS_QR', lastQr: '2@abc' }} {...noop} />);
    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
  });
  it('pair code em destaque', () => {
    render(<SessionCard session={{ ...base, status: 'NEEDS_QR', pairCode: 'ABCD-1234' }} {...noop} />);
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
  });
  it('conectada: sincronizar, desconectar, sair', () => {
    render(<SessionCard session={{ ...base, status: 'CONNECTED', phone: '5511999999999' }} {...noop} />);
    fireEvent.click(screen.getByRole('button', { name: /sincronizar grupos/i }));
    expect(noop.onSync).toHaveBeenCalledWith('s1');
    expect(screen.getByText(/5511999999999/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sair da conta/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/web test -- session-card`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/mutations.ts`**

```ts
'use client';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiClientError } from './api';

export function useApiMutation<TIn, TOut = unknown>(
  fn: (input: TIn) => Promise<TOut>,
  opts: { invalidate?: QueryKey[]; success?: string; onSuccess?: (out: TOut, input: TIn) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out, input) => {
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(out, input);
    },
    onError: (err) => {
      toast.error(err instanceof ApiClientError ? err.message : 'Erro inesperado');
    },
  });
}
```

- [ ] **Step 4: Implementar `session-card.tsx` e `groups-list.tsx`**

`src/components/whatsapp/session-card.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/app-shell/status-pill';
import type { WaSession } from '@/lib/types';

export interface SessionCardProps {
  session: WaSession;
  onConnect: (id: string, body: { mode: 'qr' | 'pair'; phone?: string }) => void;
  onDisconnect: (id: string) => void;
  onLogout: (id: string) => void;
  onDelete: (id: string) => void;
  onSync: (id: string) => void;
}

export function SessionCard({ session: s, onConnect, onDisconnect, onLogout, onDelete, onSync }: SessionCardProps) {
  const [pairOpen, setPairOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const idle = s.status === 'DISCONNECTED' || s.status === 'LOGGED_OUT';
  const pending = s.status === 'CONNECTING' || s.status === 'NEEDS_QR';

  return (
    <Card className="border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{s.label}</h3>
          <p className="text-sm text-muted">{s.phone ? `+${s.phone}` : 'Sem número vinculado'}</p>
        </div>
        <StatusPill label={s.status} status={s.status} />
      </div>

      {s.status === 'NEEDS_QR' && s.lastQr && !s.pairCode && (
        <div className="mb-4 flex flex-col items-center gap-2 rounded-lg bg-white p-4" data-testid="qr-code">
          <QRCodeSVG value={s.lastQr} size={220} />
          <p className="text-xs text-slate-700">Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo</p>
        </div>
      )}
      {s.status === 'NEEDS_QR' && s.pairCode && (
        <div className="mb-4 rounded-lg bg-surface-2 p-4 text-center">
          <p className="mb-1 text-xs text-muted">Digite este código no WhatsApp → Conectar com número de telefone</p>
          <p className="font-mono text-3xl tracking-widest text-accent">{s.pairCode}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {idle && (
          <>
            <Button size="sm" className="bg-accent hover:bg-accent/90" onClick={() => onConnect(s.id, { mode: 'qr' })}>Conectar (QR)</Button>
            <Button size="sm" variant="secondary" onClick={() => setPairOpen(true)}>Conectar (código)</Button>
          </>
        )}
        {pending && <Button size="sm" variant="secondary" onClick={() => onDisconnect(s.id)}>Cancelar</Button>}
        {s.status === 'CONNECTED' && (
          <>
            <Button size="sm" className="bg-accent hover:bg-accent/90" onClick={() => onSync(s.id)}>Sincronizar grupos</Button>
            <Button size="sm" variant="secondary" onClick={() => onDisconnect(s.id)}>Desconectar</Button>
            <Button size="sm" variant="destructive" onClick={() => onLogout(s.id)}>Sair da conta</Button>
          </>
        )}
        {idle && <Button size="sm" variant="ghost" className="text-red-300" onClick={() => onDelete(s.id)}>Excluir</Button>}
      </div>

      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Conectar com código</DialogTitle></DialogHeader>
          <p className="text-sm text-muted">Número com DDI e DDD, só dígitos (ex.: 5511999999999).</p>
          <Input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="5511999999999" />
          <Button
            disabled={phone.length < 10}
            onClick={() => { onConnect(s.id, { mode: 'pair', phone }); setPairOpen(false); }}
            className="bg-accent hover:bg-accent/90"
          >
            Gerar código
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

`src/components/whatsapp/groups-list.tsx`:
```tsx
'use client';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useGroups } from '@/lib/queries';

const PREFIX = { GROUP: '[GRUPO]', COMMUNITY: '[COMUNIDADE]', CHANNEL: '[CANAL]' } as const;

export function GroupsList({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useGroups(sessionId);
  if (isLoading) return <p className="text-sm text-muted">Carregando grupos…</p>;
  if (!data?.length) return <p className="text-sm text-muted">Nenhum grupo sincronizado. Conecte e clique em “Sincronizar grupos”.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow><TableHead>Grupo</TableHead><TableHead className="text-right">Membros</TableHead><TableHead>Permissão</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        {data.map((g) => (
          <TableRow key={g.jid}>
            <TableCell><span className="mr-2 text-xs text-muted">{PREFIX[g.kind]}</span>{g.name}</TableCell>
            <TableCell className="text-right">{g.memberCount}</TableCell>
            <TableCell>{g.botIsAdmin ? <Badge className="bg-accent/20 text-accent">Admin</Badge> : <span className="text-xs text-muted">membro</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Página `src/app/(app)/config/whatsapp/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SessionCard } from '@/components/whatsapp/session-card';
import { GroupsList } from '@/components/whatsapp/groups-list';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useSessions } from '@/lib/queries';

const INV = [['wa'], ['overview']];

export default function WhatsappPage() {
  const { data: sessions } = useSessions();
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const create = useApiMutation((body: { label: string }) => apiFetch('/wa/sessions', { method: 'POST', json: body }), { invalidate: INV, success: 'Sessão criada' });
  const cmd = useApiMutation(({ id, action, body }: { id: string; action: string; body?: unknown }) =>
    apiFetch(`/wa/sessions/${id}/${action}`, { method: 'POST', json: body ?? {} }), { invalidate: INV });
  const del = useApiMutation((id: string) => apiFetch(`/wa/sessions/${id}`, { method: 'DELETE' }), { invalidate: INV, success: 'Sessão excluída' });

  const current = sessions?.find((s) => s.id === selected) ?? sessions?.[0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">WhatsApp</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (label.trim()) { create.mutate({ label: label.trim() }); setLabel(''); } }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome da sessão (ex.: Chip 1)" className="max-w-xs" />
        <Button type="submit" className="bg-accent hover:bg-accent/90">Adicionar sessão</Button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        {(sessions ?? []).map((s) => (
          <div key={s.id} onClick={() => setSelected(s.id)}>
            <SessionCard
              session={s}
              onConnect={(id, body) => cmd.mutate({ id, action: 'connect', body })}
              onDisconnect={(id) => cmd.mutate({ id, action: 'disconnect' })}
              onLogout={(id) => cmd.mutate({ id, action: 'logout' })}
              onSync={(id) => cmd.mutate({ id, action: 'sync-groups' })}
              onDelete={(id) => { if (confirm('Excluir esta sessão?')) del.mutate(id); }}
            />
          </div>
        ))}
        {sessions?.length === 0 && <p className="text-muted">Nenhuma sessão. Adicione uma para conectar seu WhatsApp.</p>}
      </div>

      {current && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Grupos de “{current.label}”</h2>
          <GroupsList sessionId={current.id} />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rodar, typecheck, verificação manual, commit**

Run: `pnpm --filter @afilados/web test && pnpm --filter @afilados/web typecheck`
Expected: PASS (session-card 4). Manual com API+worker rodando: criar sessão → "Conectar (QR)" → QR aparece em segundos e o pill vira amarelo; após escanear (se quiser testar de verdade), vira verde e "Sincronizar grupos" preenche a tabela.

```bash
pnpm format && git add apps/web && git commit -m "feat(web): tela WhatsApp com sessões, QR/pair code e grupos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Configurações → API Shopee e Minha Conta

**Files:**
- Create: `src/app/(app)/config/shopee/page.tsx`, `src/app/(app)/config/conta/page.tsx`
- Test: `test/settings-form.test.tsx` (componente puro `SettingsForm`)
- Create: `src/components/settings/settings-form.tsx`

**Interfaces:**
- Produces:
  - `SettingsForm({ value: Settings; onSave: (patch: Partial<Settings> & { window?: Partial<Settings['window']> }) => void; saving?: boolean })` — campos: janela (início/fim `type="time"`, ativa `Switch`), limite da fila, rate limit/min, padrão de SubID; envia **apenas** campos alterados.
  - Página Shopee: formulário App Key (`appId`), Secret (campo senha; placeholder "•••••• (já salvo)" quando `hasSecret`), Tag de afiliado; botões "Salvar" (`PUT /marketplaces/SHOPEE`) e "Testar conexão" (`POST /marketplaces/SHOPEE/check`); mostra `status`, `lastCheckedAt`, `lastError`.
  - Página Conta: nome/e-mail (somente leitura, de `useMe`), `SettingsForm`; nota "Alteração de senha disponível na F7".

- [ ] **Step 1: Teste — `test/settings-form.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsForm } from '@/components/settings/settings-form';

const value = {
  window: { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true },
  queueLimit: 500, globalRateLimitPerMin: 6, subIdPattern: '{yyyyMMdd}-{batchId}',
};

describe('SettingsForm', () => {
  it('envia só os campos alterados', () => {
    const onSave = vi.fn();
    render(<SettingsForm value={value} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/limite da fila/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/fim/i), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).toHaveBeenCalledWith({ queueLimit: 100, window: { endTime: '22:00' } });
  });
  it('sem alterações não chama onSave', () => {
    const onSave = vi.fn();
    render(<SettingsForm value={value} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/web test -- settings-form`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/components/settings/settings-form.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Settings } from '@/lib/types';

type Patch = Partial<Omit<Settings, 'window'>> & { window?: Partial<Settings['window']> };

export function SettingsForm({ value, onSave, saving }: { value: Settings; onSave: (patch: Patch) => void; saving?: boolean }) {
  const [form, setForm] = useState<Settings>(value);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const patch: Patch = {};
    const w: Partial<Settings['window']> = {};
    (['startTime', 'endTime', 'timezone', 'enabled'] as const).forEach((k) => {
      if (form.window[k] !== value.window[k]) (w as Record<string, unknown>)[k] = form.window[k];
    });
    if (Object.keys(w).length) patch.window = w;
    (['queueLimit', 'globalRateLimitPerMin', 'subIdPattern'] as const).forEach((k) => {
      if (form[k] !== value[k]) (patch as Record<string, unknown>)[k] = form[k];
    });
    if (Object.keys(patch).length) onSave(patch);
  }

  const num = (k: 'queueLimit' | 'globalRateLimitPerMin') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4">
      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">Janela de operação</legend>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="start">Início</Label><Input id="start" type="time" value={form.window.startTime} onChange={(e) => setForm({ ...form, window: { ...form.window, startTime: e.target.value } })} /></div>
          <div><Label htmlFor="end">Fim</Label><Input id="end" type="time" value={form.window.endTime} onChange={(e) => setForm({ ...form, window: { ...form.window, endTime: e.target.value } })} /></div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Switch id="enabled" checked={form.window.enabled} onCheckedChange={(v) => setForm({ ...form, window: { ...form.window, enabled: v } })} />
          <Label htmlFor="enabled">Respeitar janela (bot “dorme” fora dela)</Label>
        </div>
      </fieldset>
      <div><Label htmlFor="queueLimit">Limite da fila</Label><Input id="queueLimit" type="number" min={1} value={form.queueLimit} onChange={num('queueLimit')} /></div>
      <div><Label htmlFor="rate">Máximo de mensagens por minuto (por sessão)</Label><Input id="rate" type="number" min={1} max={60} value={form.globalRateLimitPerMin} onChange={num('globalRateLimitPerMin')} /></div>
      <div><Label htmlFor="subid">Padrão de SubID</Label><Input id="subid" value={form.subIdPattern} onChange={(e) => setForm({ ...form, subIdPattern: e.target.value })} /><p className="mt-1 text-xs text-muted">Tokens: {'{yyyyMMdd} {HHmm} {batchId} {group}'}</p></div>
      <Button type="submit" disabled={saving} className="w-fit bg-accent hover:bg-accent/90">Salvar</Button>
    </form>
  );
}
```

- [ ] **Step 4: Páginas**

`src/app/(app)/config/conta/page.tsx`:
```tsx
'use client';
import { SettingsForm } from '@/components/settings/settings-form';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useMe, useSettings } from '@/lib/queries';

export default function ContaPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const save = useApiMutation((patch: unknown) => apiFetch('/settings', { method: 'PUT', json: patch }), { invalidate: [['settings']], success: 'Configurações salvas' });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Minha Conta</h1>
      {me && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <p><span className="text-muted">Nome:</span> {me.user.name}</p>
          <p><span className="text-muted">E-mail:</span> {me.user.email}</p>
          <p className="mt-2 text-xs text-muted">Alteração de senha disponível na fase F7.</p>
        </div>
      )}
      {settings && <SettingsForm key={JSON.stringify(settings)} value={settings} onSave={(p) => save.mutate(p)} saving={save.isPending} />}
    </div>
  );
}
```

`src/app/(app)/config/shopee/page.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/app-shell/status-pill';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import { useMarketplaces } from '@/lib/queries';

export default function ShopeePage() {
  const { data } = useMarketplaces();
  const conn = data?.find((m) => m.kind === 'SHOPEE');
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [tag, setTag] = useState('');
  const INV = [['marketplaces'], ['overview']];
  const save = useApiMutation((body: Record<string, string>) => apiFetch('/marketplaces/SHOPEE', { method: 'PUT', json: body }), { invalidate: INV, success: 'Credenciais salvas' });
  const check = useApiMutation(() => apiFetch('/marketplaces/SHOPEE/check', { method: 'POST' }), { invalidate: INV, success: 'Conexão verificada' });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = {};
    if (appId) body.appId = appId;
    if (secret) body.secret = secret;
    if (tag) body.affiliateTag = tag;
    if (Object.keys(body).length) save.mutate(body, { onSuccess: () => setSecret('') });
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">API Shopee</h1>
        {conn && <StatusPill label={conn.status} status={conn.status} />}
      </div>
      <p className="text-sm text-muted">Credenciais da Shopee Affiliate Open Platform. O secret é criptografado e nunca é exibido de volta.</p>
      <form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-surface p-4">
        <div><Label htmlFor="appId">App Key</Label><Input id="appId" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder={conn?.appId ?? ''} /></div>
        <div><Label htmlFor="secret">Secret</Label><Input id="secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={conn?.hasSecret ? '•••••••• (já salvo)' : ''} /></div>
        <div><Label htmlFor="tag">Tag de afiliado</Label><Input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder={conn?.affiliateTag ?? ''} /></div>
        <div className="flex gap-2">
          <Button type="submit" className="bg-accent hover:bg-accent/90" disabled={save.isPending}>Salvar</Button>
          <Button type="button" variant="secondary" onClick={() => check.mutate(undefined)} disabled={check.isPending || !conn?.hasSecret}>Testar conexão</Button>
        </div>
      </form>
      {conn && (
        <div className="text-sm text-muted">
          <p>Última verificação: {formatDateTime(conn.lastCheckedAt)}</p>
          {conn.lastError && <p className="text-red-300">Erro: {conn.lastError}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rodar, typecheck, commit**

Run: `pnpm --filter @afilados/web test && pnpm --filter @afilados/web typecheck`
Expected: PASS (settings-form 2).

```bash
pnpm format && git add apps/web && git commit -m "feat(web): telas API Shopee e Minha Conta (janela, limites, SubID)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Configurações → Templates (editor com variáveis e preview ao vivo)

**Files:**
- Create: `src/components/templates/template-editor.tsx`, `src/app/(app)/config/templates/page.tsx`
- Test: `test/template-editor.test.tsx`

**Interfaces:**
- Produces: `TemplateEditor({ initial?: Template; onSave: (t: { name: string; body: string; isDefault: boolean }) => void; onDelete?: () => void; preview: (body: string) => Promise<string>; saving?: boolean })` — `Textarea` do corpo, lista de variáveis clicáveis (`{titulo}`, `{preco}`, `{preco_antigo}`, `{desconto}`, `{vendas}`, `{link}`, `{cupom}`, `{oferta_relampago}`, `{frete}`, `{frete_gratis}`, `{frete_full}`, `{cta}`) que inserem no cursor; preview à direita atualizado com debounce de 400 ms via `preview(body)` renderizado como bolha de WhatsApp (`whitespace-pre-wrap`, `*negrito*` e `_itálico_` convertidos com regex simples); `Switch` "Template padrão".
- Página: lista de templates à esquerda (badge "Padrão"), editor à direita; "Novo template".

- [ ] **Step 1: Teste — `test/template-editor.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TemplateEditor } from '@/components/templates/template-editor';

describe('TemplateEditor', () => {
  it('insere variável no corpo e chama preview com debounce', async () => {
    vi.useFakeTimers();
    const preview = vi.fn(async (b: string) => `PREVIEW:${b}`);
    render(<TemplateEditor onSave={vi.fn()} preview={preview} />);
    fireEvent.click(screen.getByRole('button', { name: '{titulo}' }));
    expect((screen.getByLabelText(/corpo/i) as HTMLTextAreaElement).value).toContain('{titulo}');
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(preview).toHaveBeenCalledWith(expect.stringContaining('{titulo}'));
    vi.useRealTimers();
  });
  it('salva nome, corpo e isDefault', () => {
    const onSave = vi.fn();
    render(<TemplateEditor onSave={onSave} preview={async () => ''} initial={{ id: 't', name: 'A', body: '{link}', isDefault: false }} />);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Novo', body: '{link}', isDefault: false });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/web test -- template-editor`
Expected: FAIL.

- [ ] **Step 3: Implementar `template-editor.tsx`**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Template } from '@/lib/types';

export const TEMPLATE_VARS = [
  '{titulo}', '{preco}', '{preco_antigo}', '{desconto}', '{vendas}', '{link}',
  '{cupom}', '{oferta_relampago}', '{frete}', '{frete_gratis}', '{frete_full}', '{cta}',
];

function waMarkup(text: string) {
  return text
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

export function TemplateEditor({ initial, onSave, onDelete, preview, saving }: {
  initial?: Template;
  onSave: (t: { name: string; body: string; isDefault: boolean }) => void;
  onDelete?: () => void;
  preview: (body: string) => Promise<string>;
  saving?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? 'Novo template');
  const [body, setBody] = useState(initial?.body ?? '');
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [rendered, setRendered] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!body) { setRendered(''); return; }
    const t = setTimeout(() => { void preview(body).then(setRendered).catch(() => setRendered('')); }, 400);
    return () => clearTimeout(t);
  }, [body, preview]);

  function insert(v: string) {
    const el = ta.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + v + body.slice(end));
    requestAnimationFrame(() => el?.setSelectionRange(start + v.length, start + v.length));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSave({ name, body, isDefault }); }}>
        <div><Label htmlFor="tname">Nome</Label><Input id="tname" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label htmlFor="tbody">Corpo da mensagem</Label>
          <Textarea id="tbody" ref={ta} rows={12} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-sm" />
        </div>
        <div className="flex flex-wrap gap-1">
          {TEMPLATE_VARS.map((v) => (
            <button key={v} type="button" onClick={() => insert(v)} className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs hover:border-accent">{v}</button>
          ))}
        </div>
        <p className="text-xs text-muted">Blocos condicionais: {'{#cupom}…{/cupom}'} só aparecem quando a variável tem valor.</p>
        <div className="flex items-center gap-2"><Switch id="isDefault" checked={isDefault} onCheckedChange={setIsDefault} /><Label htmlFor="isDefault">Template padrão</Label></div>
        <div className="flex gap-2">
          <Button type="submit" className="bg-accent hover:bg-accent/90" disabled={saving}>Salvar</Button>
          {onDelete && <Button type="button" variant="destructive" onClick={onDelete}>Excluir</Button>}
        </div>
      </form>
      <div>
        <p className="mb-2 text-sm text-muted">Pré-visualização (produto de exemplo)</p>
        <div className="rounded-2xl bg-[#005c4b] p-4 text-sm text-white shadow" data-testid="preview">
          <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: waMarkup(rendered) }} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Página `src/app/(app)/config/templates/page.tsx`**

```tsx
'use client';
import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TemplateEditor } from '@/components/templates/template-editor';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useTemplates } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function TemplatesPage() {
  const { data: templates } = useTemplates();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const current = selected === 'new' ? undefined : templates?.find((t) => t.id === selected) ?? templates?.[0];
  const INV = [['templates']];
  const create = useApiMutation((t: unknown) => apiFetch('/templates', { method: 'POST', json: t }), { invalidate: INV, success: 'Template criado', onSuccess: (out) => setSelected((out as { id: string }).id) });
  const update = useApiMutation(({ id, t }: { id: string; t: unknown }) => apiFetch(`/templates/${id}`, { method: 'PUT', json: t }), { invalidate: INV, success: 'Template salvo' });
  const remove = useApiMutation((id: string) => apiFetch(`/templates/${id}`, { method: 'DELETE' }), { invalidate: INV, success: 'Template excluído', onSuccess: () => setSelected(null) });
  const preview = useCallback((body: string) => apiFetch<{ text: string }>('/templates/preview', { method: 'POST', json: { body } }).then((r) => r.text), []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Template das mensagens</h1>
        <Button onClick={() => setSelected('new')} className="bg-accent hover:bg-accent/90">Novo template</Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <ul className="space-y-1">
          {(templates ?? []).map((t) => (
            <li key={t.id}>
              <button onClick={() => setSelected(t.id)} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2', current?.id === t.id && 'bg-accent/15 text-accent')}>
                {t.name}{t.isDefault && <Badge className="bg-accent/20 text-accent">Padrão</Badge>}
              </button>
            </li>
          ))}
        </ul>
        <TemplateEditor
          key={current?.id ?? 'new'}
          initial={current}
          preview={preview}
          saving={create.isPending || update.isPending}
          onSave={(t) => (current ? update.mutate({ id: current.id, t }) : create.mutate(t))}
          onDelete={current && (templates?.length ?? 0) > 1 ? () => { if (confirm('Excluir este template?')) remove.mutate(current.id); } : undefined}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rodar, typecheck, commit**

Run: `pnpm --filter @afilados/web test && pnpm --filter @afilados/web typecheck`
Expected: PASS (template-editor 2).

```bash
pnpm format && git add apps/web && git commit -m "feat(web): editor de templates com variáveis e preview ao vivo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Buscar Produtos (busca Shopee, filtros, grid, importação, salvar na fila)

**Files:**
- Create: `src/components/products/search-filters.tsx`, `src/components/products/product-card.tsx`, `src/components/products/import-panel.tsx`, `src/app/(app)/produtos/page.tsx`
- Test: `test/product-card.test.tsx`, `test/search-filters.test.tsx`

**Interfaces:**
- Produces:
  - `SearchFilters({ mode, onSearch(q: SearchQuery), loading })` — `mode` ∈ `'keyword'|'category'|'trending'|'shop'`; campos: texto (keyword/shop id/categoria), ordenar (`SearchSort` com labels "Maiores descontos", "Maior comissão", "Mais vendidos", "Menor preço", "Maior preço"), quantidade (20/50/100/200), checkboxes "Top vendedores" e "Comissão extra". Monta `SearchQuery` via `searchQuerySchema.parse` de `@afilados/shared` (source `SHOPEE`).
  - `ProductCard({ product, selected, onToggle, onCopy })` — imagem, badge `-NN%`, título (2 linhas), preço, preço antigo riscado, vendas, comissão, checkbox, botão "Copiar texto + link" (chama `onCopy(product)`).
  - `ImportPanel({ onImported(result) })` — textarea de URLs (uma por linha) ou upload CSV; chama `/products/import`; lista `unsupported` com motivo.
  - Página: abas de marketplace (Shopee ativa; ML/Amazon/Magalu desabilitadas com tooltip "Fase 3"); sub-abas `Captura de Produtos | Explorar Categorias | Mais Buscados | Lojas Favoritas | Por Links / CSV`; grid; "Selecionar todos", "Salvar selecionados" (`POST /queue`); contador "Produtos salvos na fila n/limite" (de `useQueue`). Categorias Shopee fixas em `CATEGORIES` (id → nome): 11059983 Eletrônicos, 11059988 Celulares e Acessórios, 11059992 Computadores e Acessórios, 11059999 Casa e Decoração, 11060006 Eletrodomésticos, 11060020 Moda Feminina, 11060027 Moda Masculina, 11060036 Beleza, 11060044 Esportes e Lazer, 11060052 Brinquedos e Hobbies (ids conforme a árvore pública da Shopee BR; ajuste na implementação se a API devolver vazio e registre no report).

- [ ] **Step 1: Testes**

`test/product-card.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductCard } from '@/components/products/product-card';
import type { ApiProduct } from '@/lib/types';

const p: ApiProduct = {
  id: 'p1', source: 'SHOPEE', externalId: '1', title: 'Processador AMD Ryzen 5 5500', price: 848.48, originalPrice: 1194.99,
  discountPct: 29, salesCount: 6, commissionPct: 3, images: ['https://img/x.jpg'], shipping: 'UNKNOWN', flashSaleEndsAt: null,
  couponCode: null, originalUrl: 'https://shopee.com.br/product/1/1', shopId: '1', shopName: 'Loja',
};

describe('ProductCard', () => {
  it('mostra desconto, preços, vendas, comissão e alterna seleção', () => {
    const onToggle = vi.fn();
    render(<ProductCard product={p} selected={false} onToggle={onToggle} onCopy={vi.fn()} />);
    expect(screen.getByText('-29%')).toBeInTheDocument();
    expect(screen.getByText('R$ 848,48')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.194,99')).toBeInTheDocument();
    expect(screen.getByText(/6 vendidos/)).toBeInTheDocument();
    expect(screen.getByText(/3%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('p1');
  });
  it('copiar chama onCopy', () => {
    const onCopy = vi.fn();
    render(<ProductCard product={p} selected onToggle={vi.fn()} onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: /copiar texto \+ link/i }));
    expect(onCopy).toHaveBeenCalledWith(p);
  });
});
```

`test/search-filters.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchFilters } from '@/components/products/search-filters';

describe('SearchFilters', () => {
  it('monta SearchQuery de keyword com defaults', () => {
    const onSearch = vi.fn();
    render(<SearchFilters mode="keyword" onSearch={onSearch} />);
    fireEvent.change(screen.getByPlaceholderText(/palavra-chave/i), { target: { value: 'ryzen' } });
    fireEvent.click(screen.getByLabelText(/top vendedores/i));
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith({
      source: 'SHOPEE', mode: 'keyword', query: 'ryzen', sort: 'DISCOUNT_DESC', limit: 100, topSellers: true, extraCommission: false,
    });
  });
  it('trending não exige texto', () => {
    const onSearch = vi.fn();
    render(<SearchFilters mode="trending" onSearch={onSearch} />);
    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'trending' }));
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/web test -- product-card search-filters`
Expected: FAIL.

- [ ] **Step 3: Implementar `product-card.tsx`**

```tsx
'use client';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { formatBRL } from '@/lib/format';
import type { ApiProduct } from '@/lib/types';
import { cn } from '@/lib/utils';

export function ProductCard({ product: p, selected, onToggle, onCopy }: {
  product: ApiProduct; selected: boolean; onToggle: (id: string) => void; onCopy: (p: ApiProduct) => void;
}) {
  return (
    <div className={cn('relative flex flex-col rounded-lg border border-border bg-surface p-3', selected && 'border-accent')}>
      <div className="absolute left-2 top-2 z-10"><Checkbox checked={selected} onCheckedChange={() => onToggle(p.id)} aria-label="Selecionar" /></div>
      {p.discountPct ? <span className="absolute right-2 top-2 z-10 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold">-{p.discountPct}%</span> : null}
      <div className="mb-2 aspect-square overflow-hidden rounded bg-surface-2">
        {p.images[0] && <img src={p.images[0]} alt="" className="h-full w-full object-cover" loading="lazy" />}
      </div>
      <p className="mb-1 line-clamp-2 text-xs" title={p.title}>{p.title}</p>
      <p className="text-sm font-semibold">{formatBRL(p.price)}</p>
      {p.originalPrice && <p className="text-xs text-muted line-through">{formatBRL(p.originalPrice)}</p>}
      <p className="mt-1 text-[11px] text-muted">
        {p.salesCount !== null && <span>🔥 {p.salesCount} vendidos</span>}
        {p.commissionPct !== null && <span className="ml-2 text-accent">💰 {p.commissionPct}%</span>}
      </p>
      <Button size="sm" variant="secondary" className="mt-2 text-xs" onClick={() => onCopy(p)}>Copiar texto + link</Button>
    </div>
  );
}
```

- [ ] **Step 4: Implementar `search-filters.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { searchQuerySchema, type SearchMode, type SearchQuery, type SearchSort } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const SORT_LABELS: Record<SearchSort, string> = {
  DISCOUNT_DESC: 'Maiores descontos', COMMISSION_DESC: 'Maior comissão', SALES_DESC: 'Mais vendidos', PRICE_ASC: 'Menor preço', PRICE_DESC: 'Maior preço',
};
export const CATEGORIES: { id: string; name: string }[] = [
  { id: '11059983', name: 'Eletrônicos' }, { id: '11059988', name: 'Celulares e Acessórios' }, { id: '11059992', name: 'Computadores e Acessórios' },
  { id: '11059999', name: 'Casa e Decoração' }, { id: '11060006', name: 'Eletrodomésticos' }, { id: '11060020', name: 'Moda Feminina' },
  { id: '11060027', name: 'Moda Masculina' }, { id: '11060036', name: 'Beleza' }, { id: '11060044', name: 'Esportes e Lazer' }, { id: '11060052', name: 'Brinquedos e Hobbies' },
];

export function SearchFilters({ mode, onSearch, loading }: { mode: SearchMode; onSearch: (q: SearchQuery) => void; loading?: boolean }) {
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState(CATEGORIES[0]!.id);
  const [sort, setSort] = useState<SearchSort>('DISCOUNT_DESC');
  const [limit, setLimit] = useState('100');
  const [topSellers, setTopSellers] = useState(false);
  const [extraCommission, setExtraCommission] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw: Record<string, unknown> = { source: 'SHOPEE', mode, sort, limit: Number(limit), topSellers, extraCommission };
    if (mode === 'keyword') raw.query = text;
    if (mode === 'shop') raw.shopId = text;
    if (mode === 'category') raw.categoryId = categoryId;
    const parsed = searchQuerySchema.safeParse(raw);
    if (parsed.success) onSearch(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex gap-2">
        {mode === 'keyword' && <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar por palavra-chave…" className="flex-1" />}
        {mode === 'shop' && <Input value={text} onChange={(e) => setText(e.target.value.replace(/\D/g, ''))} placeholder="Shop ID da loja (ex.: 123456)" className="flex-1" />}
        {mode === 'category' && (
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {mode === 'trending' && <p className="flex-1 self-center text-sm text-muted">Itens em alta segundo a API da Shopee.</p>}
        <Button type="submit" className="bg-accent hover:bg-accent/90" disabled={loading}>{loading ? 'Buscando…' : 'Buscar'}</Button>
      </div>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <div><Label>Ordenar</Label>
          <Select value={sort} onValueChange={(v) => setSort(v as SearchSort)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(SORT_LABELS) as SearchSort[]).map((k) => <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Qtd.</Label>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{['20', '50', '100', '200'].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2"><Checkbox checked={topSellers} onCheckedChange={(v) => setTopSellers(v === true)} /> Top vendedores</label>
        <label className="flex items-center gap-2"><Checkbox checked={extraCommission} onCheckedChange={(v) => setExtraCommission(v === true)} /> Comissão extra</label>
      </div>
    </form>
  );
}
```

> shadcn `Select` usa Radix e não renderiza opções no jsdom; os testes acima não interagem com o select (usam os defaults). Se `SelectValue` falhar no jsdom, adicione `vi.mock` de `@/components/ui/select` no teste com um `<select>` nativo simples.

- [ ] **Step 5: Implementar `import-panel.tsx` e a página**

`src/components/products/import-panel.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import type { ApiProduct } from '@/lib/types';

type Result = { products: ApiProduct[]; unsupported: { url: string; reason: string }[] };

export function ImportPanel({ onImported }: { onImported: (r: Result) => void }) {
  const [text, setText] = useState('');
  const [unsupported, setUnsupported] = useState<Result['unsupported']>([]);
  const imp = useApiMutation((body: { urls: string[] } | FormData) =>
    body instanceof FormData
      ? apiFetch<Result>('/products/import', { method: 'POST', body })
      : apiFetch<Result>('/products/import', { method: 'POST', json: body }),
  { onSuccess: (r) => { setUnsupported(r.unsupported); onImported(r); } });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Cole uma URL por linha\nhttps://shopee.com.br/...'} />
      <div className="flex items-center gap-3">
        <Button className="bg-accent hover:bg-accent/90" disabled={imp.isPending || !text.trim()} onClick={() => imp.mutate({ urls: text.split(/\s+/).filter(Boolean) })}>Importar links</Button>
        <label className="cursor-pointer text-sm text-accent underline">
          ou enviar CSV (coluna <code>url</code>)
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.append('file', f); imp.mutate(fd); } }} />
        </label>
      </div>
      {unsupported.length > 0 && (
        <ul className="text-xs text-amber-300">
          {unsupported.map((u) => <li key={u.url}>{u.url} — {u.reason}</li>)}
        </ul>
      )}
    </div>
  );
}
```

`src/app/(app)/produtos/page.tsx`:
```tsx
'use client';
import { useState } from 'react';
import type { SearchMode, SearchQuery } from '@afilados/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductCard } from '@/components/products/product-card';
import { SearchFilters } from '@/components/products/search-filters';
import { ImportPanel } from '@/components/products/import-panel';
import { apiFetch } from '@/lib/api';
import { formatBRL } from '@/lib/format';
import { useApiMutation } from '@/lib/mutations';
import { useQueue } from '@/lib/queries';
import type { ApiProduct } from '@/lib/types';

const SUBTABS: { key: SearchMode | 'import'; label: string }[] = [
  { key: 'keyword', label: 'Captura de Produtos' }, { key: 'category', label: 'Explorar Categorias' },
  { key: 'trending', label: 'Mais Buscados' }, { key: 'shop', label: 'Lojas Favoritas' }, { key: 'import', label: 'Por Links / CSV' },
];

export default function ProdutosPage() {
  const [sub, setSub] = useState<SearchMode | 'import'>('keyword');
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: queue } = useQueue();

  const search = useApiMutation((q: SearchQuery) => apiFetch<{ products: ApiProduct[] }>('/products/search', { method: 'POST', json: q }), {
    onSuccess: (r) => { setProducts(r.products); setSelected(new Set()); },
  });
  const save = useApiMutation((productIds: string[]) => apiFetch<{ added: number; count: number }>('/queue', { method: 'POST', json: { productIds } }), {
    invalidate: [['queue'], ['overview']],
    onSuccess: (r) => { toast.success(`${r.added} produto(s) salvos na fila`); setSelected(new Set()); },
  });

  function toggle(id: string) { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); }
  function toggleAll() { setSelected(selected.size === products.length ? new Set() : new Set(products.map((p) => p.id))); }
  async function copy(p: ApiProduct) {
    await navigator.clipboard.writeText(`${p.title}\n${formatBRL(p.price)}\n${p.originalUrl}`);
    toast.success('Copiado');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Buscar Produtos</h1>
        <span className="rounded-md border border-border bg-surface px-3 py-1 text-sm">Produtos salvos na fila <b className="text-accent">{queue?.count ?? 0}</b> / {queue?.limit ?? '—'}</span>
      </div>
      <Tabs value="SHOPEE">
        <TabsList>
          <TabsTrigger value="SHOPEE">Shopee</TabsTrigger>
          <TabsTrigger value="ML" disabled title="Disponível na fase 3">Mercado Livre</TabsTrigger>
          <TabsTrigger value="AMZ" disabled title="Disponível na fase 3">Amazon</TabsTrigger>
          <TabsTrigger value="MGL" disabled title="Disponível na fase 3">Magalu</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex gap-4 border-b border-border text-sm">
        {SUBTABS.map((t) => (
          <button key={t.key} onClick={() => setSub(t.key)} className={`-mb-px border-b-2 px-1 pb-2 ${sub === t.key ? 'border-accent text-accent' : 'border-transparent text-muted'}`}>{t.label}</button>
        ))}
      </div>

      {sub === 'import'
        ? <ImportPanel onImported={(r) => { setProducts(r.products); setSelected(new Set(r.products.map((p) => p.id))); }} />
        : <SearchFilters key={sub} mode={sub} onSearch={(q) => search.mutate(q)} loading={search.isPending} />}

      {products.length > 0 && (
        <>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">
            <Button size="sm" variant="secondary" onClick={toggleAll}>{selected.size === products.length ? 'Desmarcar todos' : `Selecionar todos (${products.length})`}</Button>
            <span className="text-muted">{selected.size} selecionado(s)</span>
            <Button size="sm" className="ml-auto bg-accent hover:bg-accent/90" disabled={!selected.size || save.isPending} onClick={() => save.mutate([...selected])}>Salvar selecionados</Button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {products.map((p) => <ProductCard key={p.id} product={p} selected={selected.has(p.id)} onToggle={toggle} onCopy={copy} />)}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Rodar, typecheck, verificação manual, commit**

Run: `pnpm --filter @afilados/web test && pnpm --filter @afilados/web typecheck`
Expected: PASS (product-card 2, search-filters 2). Manual: com `SHOPEE_MOCK=1` na API e credenciais fake salvas em API Shopee, buscar "ryzen" → 2 cards; salvar → contador da fila sobe.

```bash
pnpm format && git add apps/web && git commit -m "feat(web): busca de produtos Shopee com filtros, grid, importação e fila

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Enviar Ofertas (fila, grupos, lote, progresso) e Visão Geral

**Files:**
- Create: `src/components/queue/queue-table.tsx`, `src/components/queue/batch-form.tsx`, `src/components/queue/batch-list.tsx`, `src/app/(app)/enviar/page.tsx`
- Modify: `src/app/(app)/page.tsx` (Visão Geral final)
- Test: `test/batch-form.test.tsx`

**Interfaces:**
- Consumes: `scheduleBatch`, `isWithinOperatingWindow` de `@afilados/core` (pré-visualização da previsão de término no cliente).
- Produces:
  - `QueueTable({ data: QueueResponse; onSelect(ids, selected); onRemove(id); onClearSent() })` — colunas Produto (miniatura + título), Loja (badge `source`), Preço, Desc., Status (`StatusPill`), remover; header com "Selecionar todos"/"Desmarcar todos" e "Limpar enviados".
  - `BatchForm({ sessions, groups, templates, settings, selectedCount, onCreate(body: BatchCreateBody) })` — nome, sessão (só `CONNECTED` habilitadas), grupos (checkboxes com prefixo `[CANAL]/[GRUPO]`), intervalo (min), formato `IMAGE|PREVIEW` (toggle "Imagem" / "Preview"), template, `Switch` "Embaralhar"; mostra "Previsão de término: dd/mm hh:mm" calculada com `scheduleBatch(selectedCount, intervalMin, settings.window, new Date())` e aviso quando fora da janela agora.
  - `BatchList({ batches; onPause; onResume; onCancel })` — nome, status pill, barra de progresso `sent/total`, erros, previsão, ações por status.
  - Visão Geral: cards WA (por sessão), Shopee, Fila `n/limite`, lotes ativos com barra, últimos erros.

- [ ] **Step 1: Teste — `test/batch-form.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchForm } from '@/components/queue/batch-form';

const settings = { window: { startTime: '00:00', endTime: '23:59', timezone: 'America/Sao_Paulo', enabled: true }, queueLimit: 500, globalRateLimitPerMin: 6, subIdPattern: 'x' };
const sessions = [
  { id: 's1', label: 'Chip 1', phone: '55', status: 'CONNECTED' as const, lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' },
  { id: 's2', label: 'Chip 2', phone: null, status: 'DISCONNECTED' as const, lastQr: null, pairCode: null, lastSeenAt: null, createdAt: '' },
];
const groups = [
  { id: 'g1', jid: 'g1@g.us', name: 'Ofertas', kind: 'GROUP' as const, botIsAdmin: true, memberCount: 10 },
  { id: 'g2', jid: 'g2@newsletter', name: 'Canal', kind: 'CHANNEL' as const, botIsAdmin: true, memberCount: 0 },
];
const templates = [{ id: 't1', name: 'Padrão', body: '{link}', isDefault: true }];

describe('BatchForm', () => {
  it('cria lote com grupos marcados e mostra previsão', () => {
    const onCreate = vi.fn();
    render(<BatchForm sessions={sessions} groups={groups} templates={templates} settings={settings} selectedCount={3} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText(/nome do lote/i), { target: { value: 'Lote 1' } });
    fireEvent.click(screen.getByLabelText(/\[GRUPO\] Ofertas/));
    fireEvent.change(screen.getByLabelText(/intervalo/i), { target: { value: '10' } });
    expect(screen.getByText(/previsão de término/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /criar lote/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Lote 1', sessionId: 's1', templateId: 't1', groupJids: ['g1@g.us'], intervalMin: 10, mediaMode: 'IMAGE', shuffled: false,
    }));
  });
  it('desabilita criar sem grupos ou sem itens', () => {
    render(<BatchForm sessions={sessions} groups={groups} templates={templates} settings={settings} selectedCount={0} onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /criar lote/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @afilados/web test -- batch-form`
Expected: FAIL.

- [ ] **Step 3: Implementar `batch-form.tsx`**

```tsx
'use client';
import { useMemo, useState } from 'react';
import { isWithinOperatingWindow, scheduleBatch } from '@afilados/core';
import type { BatchCreateBody } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/lib/format';
import type { Settings, Template, WaGroup, WaSession } from '@/lib/types';
import { cn } from '@/lib/utils';

const PREFIX = { GROUP: '[GRUPO]', COMMUNITY: '[COMUNIDADE]', CHANNEL: '[CANAL]' } as const;

export function BatchForm({ sessions, groups, templates, settings, selectedCount, onCreate, creating, onSessionChange }: {
  sessions: WaSession[]; groups: WaGroup[]; templates: Template[]; settings: Settings; selectedCount: number;
  onCreate: (body: BatchCreateBody) => void; creating?: boolean; onSessionChange?: (id: string) => void;
}) {
  const connected = sessions.filter((s) => s.status === 'CONNECTED');
  const [name, setName] = useState('');
  const [sessionId, setSessionId] = useState(connected[0]?.id ?? '');
  const [templateId, setTemplateId] = useState(templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '');
  const [jids, setJids] = useState<Set<string>>(new Set());
  const [intervalMin, setIntervalMin] = useState(10);
  const [mediaMode, setMediaMode] = useState<'IMAGE' | 'PREVIEW'>('IMAGE');
  const [shuffled, setShuffled] = useState(false);

  const now = useMemo(() => new Date(), [selectedCount, intervalMin]);
  const schedule = useMemo(() => scheduleBatch(selectedCount, Math.max(1, intervalMin), settings.window, now), [selectedCount, intervalMin, settings.window, now]);
  const outside = !isWithinOperatingWindow(now, settings.window);
  const canCreate = !!name.trim() && !!sessionId && !!templateId && jids.size > 0 && selectedCount > 0 && intervalMin >= 1;

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
      onSubmit={(e) => { e.preventDefault(); if (canCreate) onCreate({ name: name.trim(), sessionId, templateId, groupJids: [...jids], intervalMin, mediaMode, shuffled }); }}
    >
      <h2 className="font-semibold">Personalização do disparo</h2>
      <div><Label htmlFor="bname">Nome do lote</Label><Input id="bname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ofertas da manhã" /></div>
      <div>
        <Label htmlFor="bsession">Sessão WhatsApp</Label>
        <select id="bsession" value={sessionId} onChange={(e) => { setSessionId(e.target.value); setJids(new Set()); onSessionChange?.(e.target.value); }} className="mt-1 w-full rounded-md border border-border bg-surface-2 p-2 text-sm">
          {sessions.map((s) => <option key={s.id} value={s.id} disabled={s.status !== 'CONNECTED'}>{s.label} {s.status !== 'CONNECTED' ? `(${s.status})` : ''}</option>)}
        </select>
      </div>
      <div>
        <Label>Grupos ({jids.size})</Label>
        <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {groups.length === 0 && <p className="text-xs text-muted">Nenhum grupo — sincronize em Configurações → WhatsApp.</p>}
          {groups.map((g) => (
            <label key={g.jid} className="flex items-center gap-2 text-sm">
              <Checkbox checked={jids.has(g.jid)} onCheckedChange={(v) => { const s = new Set(jids); v ? s.add(g.jid) : s.delete(g.jid); setJids(s); }} aria-label={`${PREFIX[g.kind]} ${g.name}`} />
              <span className="text-xs text-muted">{PREFIX[g.kind]}</span> {g.name}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="binterval">Intervalo (minutos entre envios)</Label><Input id="binterval" type="number" min={1} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} /></div>
        <div>
          <Label>Formato de mídia</Label>
          <div className="mt-1 flex rounded-md border border-border p-0.5 text-sm">
            {(['IMAGE', 'PREVIEW'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMediaMode(m)} className={cn('flex-1 rounded px-2 py-1', mediaMode === m && 'bg-accent text-white')}>{m === 'IMAGE' ? 'Imagem' : 'Preview'}</button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">{mediaMode === 'IMAGE' ? 'Imagem + legenda (ocupa a galeria do cliente).' : 'Link com pré-visualização (não lota a galeria).'}</p>
        </div>
      </div>
      <div>
        <Label htmlFor="btemplate">Template</Label>
        <select id="btemplate" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface-2 p-2 text-sm">
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (padrão)' : ''}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2"><Switch id="shuffle" checked={shuffled} onCheckedChange={setShuffled} /><Label htmlFor="shuffle">Embaralhar ordem dos produtos</Label></div>
      <div className="rounded-md bg-surface-2 p-3 text-sm">
        <p>{selectedCount} produto(s) selecionado(s) × {jids.size} grupo(s)</p>
        <p>Previsão de término: <b>{schedule.estimatedEndAt ? formatDateTime(schedule.estimatedEndAt) : '—'}</b></p>
        {outside && <p className="text-amber-300">Fora da janela de operação agora — o 1º envio sai às {settings.window.startTime}.</p>}
      </div>
      <Button type="submit" className="w-full bg-accent hover:bg-accent/90" disabled={!canCreate || creating}>Criar lote</Button>
    </form>
  );
}
```

- [ ] **Step 4: Implementar `queue-table.tsx` e `batch-list.tsx`**

`src/components/queue/queue-table.tsx`:
```tsx
'use client';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusPill } from '@/components/app-shell/status-pill';
import { formatBRL } from '@/lib/format';
import type { QueueResponse } from '@/lib/types';

export function QueueTable({ data, onSelect, onRemove, onClearSent }: {
  data: QueueResponse; onSelect: (ids: string[], selected: boolean) => void; onRemove: (id: string) => void; onClearSent: () => void;
}) {
  const allSelected = data.items.length > 0 && data.items.every((i) => i.selected);
  const selectedCount = data.items.filter((i) => i.selected && i.status === 'PENDING').length;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
        <b>Produtos salvos ({data.count}/{data.limit})</b>
        <Button size="sm" variant="secondary" onClick={() => onSelect(data.items.map((i) => i.id), !allSelected)}>{allSelected ? 'Desmarcar todos' : 'Selecionar todos'}</Button>
        <span className="text-muted">{selectedCount} selecionado(s) pendente(s)</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClearSent}>Limpar enviados</Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead className="w-8" /><TableHead>Produto</TableHead><TableHead>Loja</TableHead><TableHead className="text-right">Preço</TableHead><TableHead className="text-right">Desc.</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {data.items.map((i) => (
            <TableRow key={i.id} className={i.status !== 'PENDING' ? 'opacity-60' : ''}>
              <TableCell><Checkbox checked={i.selected} disabled={i.status !== 'PENDING'} onCheckedChange={(v) => onSelect([i.id], v === true)} /></TableCell>
              <TableCell className="flex items-center gap-2">{i.product.images[0] && <img src={i.product.images[0]} alt="" className="h-8 w-8 rounded object-cover" />}<span className="line-clamp-1 max-w-xs text-sm">{i.product.title}</span></TableCell>
              <TableCell><Badge variant="secondary">{i.product.source}</Badge></TableCell>
              <TableCell className="text-right text-accent">{formatBRL(i.product.price)}</TableCell>
              <TableCell className="text-right">{i.product.discountPct ? `-${i.product.discountPct}%` : '—'}</TableCell>
              <TableCell><StatusPill label={i.status === 'PENDING' ? 'Pendente' : i.status === 'SENT' ? 'Enviado' : 'Erro'} status={i.status} /></TableCell>
              <TableCell><button onClick={() => onRemove(i.id)} aria-label="Remover" className="text-muted hover:text-red-300"><Trash2 className="h-4 w-4" /></button></TableCell>
            </TableRow>
          ))}
          {data.items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted">Fila vazia — salve produtos em “Buscar Produtos”.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}
```

`src/components/queue/batch-list.tsx`:
```tsx
'use client';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/app-shell/status-pill';
import { formatDateTime } from '@/lib/format';
import type { BatchSummary } from '@/lib/types';

const LABEL: Record<string, string> = { SCHEDULED: 'Agendado', RUNNING: 'Enviando', PAUSED: 'Pausado', DONE: 'Concluído', CANCELLED: 'Cancelado' };

export function BatchList({ batches, onPause, onResume, onCancel }: {
  batches: BatchSummary[]; onPause: (id: string) => void; onResume: (id: string) => void; onCancel: (id: string) => void;
}) {
  if (!batches.length) return <p className="text-sm text-muted">Nenhum lote criado ainda.</p>;
  return (
    <ul className="space-y-2">
      {batches.map((b) => {
        const pct = b.total ? Math.round((b.sent / b.total) * 100) : 0;
        const active = b.status === 'SCHEDULED' || b.status === 'RUNNING';
        return (
          <li key={b.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
            <div className="flex items-center gap-2">
              <b>{b.name}</b>
              <StatusPill label={LABEL[b.status] ?? b.status} status={b.status} />
              <span className="ml-auto text-xs text-muted">{b.sent}/{b.total} · {b.errors > 0 ? `${b.errors} erro(s) · ` : ''}término {formatDateTime(b.estimatedEndAt)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="mt-2 flex gap-2">
              {active && <Button size="sm" variant="secondary" onClick={() => onPause(b.id)}>Pausar</Button>}
              {b.status === 'PAUSED' && <Button size="sm" className="bg-accent hover:bg-accent/90" onClick={() => onResume(b.id)}>Retomar</Button>}
              {(active || b.status === 'PAUSED') && <Button size="sm" variant="destructive" onClick={() => onCancel(b.id)}>Cancelar</Button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Página `enviar` e Visão Geral**

`src/app/(app)/enviar/page.tsx`:
```tsx
'use client';
import { useState } from 'react';
import type { BatchCreateBody } from '@afilados/shared';
import { QueueTable } from '@/components/queue/queue-table';
import { BatchForm } from '@/components/queue/batch-form';
import { BatchList } from '@/components/queue/batch-list';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useBatches, useGroups, useQueue, useSessions, useSettings, useTemplates } from '@/lib/queries';

export default function EnviarPage() {
  const { data: queue } = useQueue();
  const { data: sessions } = useSessions();
  const { data: templates } = useTemplates();
  const { data: settings } = useSettings();
  const { data: batches } = useBatches();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const activeSession = sessionId ?? sessions?.find((s) => s.status === 'CONNECTED')?.id ?? null;
  const { data: groups } = useGroups(activeSession);

  const INV = [['queue'], ['batches'], ['overview']];
  const select = useApiMutation((b: { ids: string[]; selected: boolean }) => apiFetch('/queue/select', { method: 'POST', json: b }), { invalidate: [['queue']] });
  const remove = useApiMutation((id: string) => apiFetch(`/queue/${id}`, { method: 'DELETE' }), { invalidate: [['queue'], ['overview']] });
  const clearSent = useApiMutation(() => apiFetch('/queue?status=SENT', { method: 'DELETE' }), { invalidate: [['queue'], ['overview']], success: 'Enviados removidos' });
  const create = useApiMutation((body: BatchCreateBody) => apiFetch('/batches', { method: 'POST', json: body }), { invalidate: INV, success: 'Lote criado e agendado' });
  const action = useApiMutation(({ id, a }: { id: string; a: 'pause' | 'resume' | 'cancel' }) => apiFetch(`/batches/${id}/${a}`, { method: 'POST' }), { invalidate: INV });

  const selectedCount = queue?.items.filter((i) => i.selected && i.status === 'PENDING').length ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Enviar Ofertas</h1>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {queue && <QueueTable data={queue} onSelect={(ids, selected) => select.mutate({ ids, selected })} onRemove={(id) => remove.mutate(id)} onClearSent={() => clearSent.mutate(undefined)} />}
          <section><h2 className="mb-2 font-semibold">Lotes</h2><BatchList batches={batches ?? []} onPause={(id) => action.mutate({ id, a: 'pause' })} onResume={(id) => action.mutate({ id, a: 'resume' })} onCancel={(id) => { if (confirm('Cancelar este lote?')) action.mutate({ id, a: 'cancel' }); }} /></section>
        </div>
        {sessions && templates && settings && (
          <BatchForm sessions={sessions} groups={groups ?? []} templates={templates} settings={settings} selectedCount={selectedCount} creating={create.isPending} onCreate={(b) => create.mutate(b)} onSessionChange={setSessionId} />
        )}
      </div>
    </div>
  );
}
```

`src/app/(app)/page.tsx` (final):
```tsx
'use client';
import Link from 'next/link';
import { StatusPill } from '@/components/app-shell/status-pill';
import { formatDateTime } from '@/lib/format';
import { useOverview } from '@/lib/queries';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface p-4"><p className="mb-2 text-xs uppercase tracking-wider text-muted">{title}</p>{children}</div>;
}

export default function OverviewPage() {
  const { data } = useOverview();
  if (!data) return <p className="text-muted">Carregando…</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Visão Geral</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="WhatsApp">
          {data.wa.length === 0 && <Link href="/config/whatsapp" className="text-accent underline">Conectar um número</Link>}
          {data.wa.map((s) => <div key={s.id} className="flex items-center justify-between py-1 text-sm"><span>{s.label} {s.phone && <span className="text-muted">+{s.phone}</span>}</span><StatusPill label={s.status} status={s.status} /></div>)}
        </Card>
        <Card title="Shopee"><StatusPill label={data.shopee} status={data.shopee} /> <Link href="/config/shopee" className="ml-2 text-xs text-accent underline">configurar</Link></Card>
        <Card title="Fila de produtos"><p className="text-3xl font-bold">{data.queue.count}<span className="text-base text-muted"> / {data.queue.limit}</span></p><Link href="/produtos" className="text-xs text-accent underline">buscar produtos</Link></Card>
      </div>
      <Card title="Lotes ativos">
        {data.batches.length === 0 && <p className="text-sm text-muted">Nenhum lote em andamento.</p>}
        {data.batches.map((b) => (
          <div key={b.id} className="py-2 text-sm">
            <div className="flex items-center gap-2"><b>{b.name}</b><StatusPill label={b.status} status={b.status} /><span className="ml-auto text-xs text-muted">{b.sent}/{b.total} · término {formatDateTime(b.estimatedEndAt)}</span></div>
            <div className="mt-1 h-1.5 rounded bg-surface-2"><div className="h-full rounded bg-accent" style={{ width: `${b.total ? Math.round((b.sent / b.total) * 100) : 0}%` }} /></div>
          </div>
        ))}
      </Card>
      <Card title="Últimos erros de envio">
        {data.errors.length === 0 && <p className="text-sm text-muted">Sem erros recentes.</p>}
        <ul className="space-y-1 text-xs">{data.errors.map((e) => <li key={e.id}><span className="text-muted">{formatDateTime(e.sentAt)}</span> · {e.groupJid} · <span className="text-red-300">{e.error}</span></li>)}</ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Rodar, typecheck, build, verificação manual, commit**

Run: `pnpm --filter @afilados/web test && pnpm --filter @afilados/web typecheck && pnpm --filter @afilados/web build`
Expected: PASS (batch-form 2); build OK. Manual: com sessão conectada e grupos sincronizados, criar lote com 2 produtos/intervalo 1 min → barra avança e a fila marca “Enviado” em tempo real.

```bash
pnpm format && git add apps/web && git commit -m "feat(web): Enviar Ofertas (fila, lote, progresso em tempo real) e Visão Geral

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: E2E Playwright do fluxo crítico

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/seed.ts`, `apps/web/e2e/fluxo-principal.spec.ts`
- Modify: `apps/web/package.json` (script `e2e:seed`), `README.md`

**Interfaces:**
- Produces: `e2e/seed.ts` — cria (idempotente) tenant `e2e`, usuário `e2e@test.local` / `e2e-senha-123`, conexão Shopee fake (`encryptJson({appId:'a',secret:'s'})`, status OK), sessão WA `CONNECTED` com grupo `e2e@g.us`, template padrão, janela 00:00–23:59; imprime nada. Usa `@afilados/db` via `tsx`. Exige `SHOPEE_MOCK=1` na API para a busca funcionar.
- Fluxo testado: login → `/config/templates` preview contém o link de exemplo → `/produtos` busca "ryzen" retorna cards → salvar 2 → `/enviar` mostra fila com 2 → criar lote com grupo `e2e@g.us`, intervalo 1 → lista mostra o lote `Agendado`/`Enviando`.

- [ ] **Step 1: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  webServer: process.env.E2E_NO_SERVER ? undefined : { command: 'pnpm dev', port: 3000, reuseExistingServer: true, timeout: 120_000 },
});
```
Script em `apps/web/package.json`: `"e2e:seed": "tsx e2e/seed.ts"` (adicionar `tsx` às devDeps).

- [ ] **Step 2: `e2e/seed.ts`**

```ts
import { hash } from '@node-rs/argon2';
import { prisma, encryptJson } from '@afilados/db';

const EMAIL = 'e2e@test.local';
const PASSWORD = 'e2e-senha-123';

async function main() {
  const tenant = (await prisma.tenant.findFirst({ where: { name: 'e2e' } })) ?? (await prisma.tenant.create({ data: { name: 'e2e' } }));
  await prisma.user.upsert({ where: { email: EMAIL }, update: {}, create: { tenantId: tenant.id, email: EMAIL, name: 'E2E', passwordHash: await hash(PASSWORD) } });
  await prisma.operatingWindow.upsert({ where: { tenantId: tenant.id }, update: { startTime: '00:00', endTime: '23:59' }, create: { tenantId: tenant.id, startTime: '00:00', endTime: '23:59' } });
  if (!(await prisma.template.findFirst({ where: { tenantId: tenant.id } }))) {
    await prisma.template.create({ data: { tenantId: tenant.id, name: 'Padrão', body: '*{titulo}*\n{preco}\n{link}', isDefault: true } });
  }
  await prisma.marketplaceConnection.upsert({
    where: { tenantId_kind: { tenantId: tenant.id, kind: 'SHOPEE' } },
    update: { status: 'OK' },
    create: { tenantId: tenant.id, kind: 'SHOPEE', status: 'OK', encryptedCredentials: encryptJson({ appId: 'a', secret: 's' }) },
  });
  const session = (await prisma.waSession.findFirst({ where: { tenantId: tenant.id, label: 'E2E' } })) ??
    (await prisma.waSession.create({ data: { tenantId: tenant.id, label: 'E2E', status: 'CONNECTED', phone: '5511999990000' } }));
  await prisma.waSession.update({ where: { id: session.id }, data: { status: 'CONNECTED' } });
  await prisma.waGroup.upsert({ where: { sessionId_jid: { sessionId: session.id, jid: 'e2e@g.us' } }, update: {}, create: { tenantId: tenant.id, sessionId: session.id, jid: 'e2e@g.us', name: 'Grupo E2E', botIsAdmin: true, memberCount: 3 } });
  // limpa fila/lotes de execuções anteriores
  await prisma.batch.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.queueItem.deleteMany({ where: { tenantId: tenant.id } });
}
main().finally(() => prisma.$disconnect());
```

- [ ] **Step 3: `e2e/fluxo-principal.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('login → template → busca → fila → lote', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('e2e@test.local');
  await page.getByLabel('Senha').fill('e2e-senha-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible();

  await page.goto('/config/templates');
  await expect(page.getByTestId('preview')).toContainText('s.shopee.com.br/exemplo', { timeout: 10_000 });

  await page.goto('/produtos');
  await page.getByPlaceholder(/palavra-chave/i).fill('ryzen');
  await page.getByRole('button', { name: 'Buscar' }).click();
  const cards = page.getByRole('checkbox', { name: 'Selecionar' });
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /selecionar todos/i }).click();
  await page.getByRole('button', { name: 'Salvar selecionados' }).click();
  await expect(page.getByText(/produto\(s\) salvos na fila/)).toBeVisible();

  await page.goto('/enviar');
  await expect(page.getByText(/Produtos salvos \(2\//)).toBeVisible();
  await page.getByLabel('Nome do lote').fill('Lote E2E');
  await page.getByLabel('[GRUPO] Grupo E2E').check();
  await page.getByLabel(/intervalo/i).fill('1');
  await page.getByRole('button', { name: 'Criar lote' }).click();
  await expect(page.getByText('Lote criado e agendado')).toBeVisible();
  await expect(page.getByText('Lote E2E')).toBeVisible();
  await expect(page.getByText(/Agendado|Enviando|Concluído/).first()).toBeVisible();
});

test('logout invalida sessão', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('e2e@test.local');
  await page.getByLabel('Senha').fill('e2e-senha-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/produtos');
  await expect(page).toHaveURL(/\/login$/);
});
```

- [ ] **Step 4: Rodar**

Pré-requisitos: `docker compose up -d --wait`; em outro terminal `set -a && . ./.env && set +a && SHOPEE_MOCK=1 pnpm --filter @afilados/api start`; worker **não** precisa estar rodando (o lote fica `Agendado`; se o worker estiver rodando com sessão E2E fake, os envios falharão com `WA_NOT_CONNECTED` e o lote termina com erros — aceitável para o E2E, que só valida a criação).
Run: `set -a && . ./.env && set +a && pnpm --filter @afilados/web e2e:seed && pnpm --filter @afilados/web exec playwright install chromium && pnpm --filter @afilados/web e2e`
Expected: 2 testes PASS.

- [ ] **Step 5: README — seção "Web e E2E"; commit**

Acrescentar ao `README.md`:
````markdown
## Web (painel)

```bash
pnpm --filter @afilados/web dev     # http://localhost:3000 (proxy /api → :3001)
```

E2E (API rodando com `SHOPEE_MOCK=1`):

```bash
set -a && . ./.env && set +a
pnpm --filter @afilados/web e2e:seed
pnpm --filter @afilados/web e2e
```
````

```bash
pnpm format && git add apps/web README.md && git commit -m "test(web): E2E Playwright do fluxo login→template→busca→fila→lote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Deploy — Dockerfiles, Compose de produção, Caddy e `deploy.sh`

**Files:**
- Create: `deploy/Dockerfile.api`, `deploy/Dockerfile.worker`, `deploy/Dockerfile.web`, `deploy/Caddyfile`, `docker-compose.prod.yml`, `deploy.sh`, `.dockerignore`
- Modify: `.env.example` (variáveis de produção), `README.md` (seção Deploy)

**Interfaces:**
- Produces: `docker compose -f docker-compose.prod.yml up -d --build` sobe `postgres`, `redis`, `api`, `worker`, `web`, `caddy`; Caddy em `:80/:443` com TLS automático para `${DOMAIN}`: `/api/*` → `api:3001` (inclui WS), resto → `web:3000`. `deploy.sh` faz `git pull`, build, `prisma migrate deploy`, `up -d`, `docker image prune -f`. Backup diário: serviço `backup` com `pg_dump` para `./backups/` (retém 14 dias).

- [ ] **Step 1: `.dockerignore`**

```
node_modules
**/node_modules
.next
**/.next
.turbo
**/.turbo
coverage
.superpowers
.env
.env.*
!.env.example
backups
```

- [ ] **Step 2: `deploy/Dockerfile.api` e `deploy/Dockerfile.worker`** (tsx em runtime; instalam o workspace inteiro para preservar os links `workspace:*`)

`deploy/Dockerfile.api`:
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/marketplaces/package.json packages/marketplaces/
RUN pnpm install --frozen-lockfile --filter @afilados/api... --filter @afilados/db...
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @afilados/db generate
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "--filter", "@afilados/api", "start"]
```

`deploy/Dockerfile.worker`: idêntico trocando `apps/api` → `apps/worker`, `@afilados/api` → `@afilados/worker`, `EXPOSE 3002`. Como `sharp` precisa de libs nativas no Alpine, adicionar após `WORKDIR`: `RUN apk add --no-cache libc6-compat vips-dev`.

- [ ] **Step 3: `deploy/Dockerfile.web`** (build standalone)

```dockerfile
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @afilados/web...
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY apps/web ./apps/web
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm --filter @afilados/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

> Em produção o Caddy roteia `/api/*` antes de chegar ao Next, então o `rewrites()` do `next.config.ts` nunca é acionado; `API_INTERNAL_URL` fica sem uso na imagem `web`.

- [ ] **Step 4: `deploy/Caddyfile`**

```
{$DOMAIN} {
  encode zstd gzip
  @api path /api/*
  handle @api {
    reverse_proxy api:3001
  }
  handle {
    reverse_proxy web:3000
  }
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy strict-origin-when-cross-origin
  }
}
```

- [ ] **Step 5: `docker-compose.prod.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: afilados
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: afilados
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U afilados"]
      interval: 10s
      retries: 10
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes: ["redisdata:/data"]
  api:
    build: { context: ., dockerfile: deploy/Dockerfile.api }
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://afilados:${POSTGRES_PASSWORD}@postgres:5432/afilados
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
      WEB_ORIGIN: https://${DOMAIN}
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
  worker:
    build: { context: ., dockerfile: deploy/Dockerfile.worker }
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://afilados:${POSTGRES_PASSWORD}@postgres:5432/afilados
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
  web:
    build:
      context: .
      dockerfile: deploy/Dockerfile.web
      args: { NEXT_PUBLIC_WS_URL: "wss://${DOMAIN}/api/v1/ws" }
    restart: unless-stopped
    depends_on: [api]
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment: { DOMAIN: ${DOMAIN} }
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    depends_on: [web, api]
  backup:
    image: postgres:16-alpine
    restart: unless-stopped
    environment: { PGPASSWORD: ${POSTGRES_PASSWORD} }
    volumes: ["./backups:/backups"]
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        while true; do
          pg_dump -h postgres -U afilados afilados | gzip > /backups/afilados-$(date +%F).sql.gz
          find /backups -name '*.sql.gz' -mtime +14 -delete
          sleep 86400
        done
    depends_on:
      postgres: { condition: service_healthy }
volumes:
  pgdata:
  redisdata:
  caddydata:
  caddyconfig:
```

Adicionar ao `.env.example`:
```
# Produção (docker-compose.prod.yml)
POSTGRES_PASSWORD=troque-esta-senha
# DOMAIN já existe acima — use o domínio público (ex.: painel.seudominio.com.br)
```

- [ ] **Step 6: `deploy.sh`**

```bash
#!/usr/bin/env bash
# Uso no VPS: ./deploy.sh  (a partir da raiz do repositório, com .env preenchido)
set -euo pipefail
cd "$(dirname "$0")"
test -f .env || { echo "Crie o .env a partir de .env.example"; exit 1; }
git pull --ff-only
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @afilados/db exec prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d
docker image prune -f
docker compose -f docker-compose.prod.yml ps
echo "Deploy concluído: https://${DOMAIN:-$(grep ^DOMAIN= .env | cut -d= -f2)}"
```
`chmod +x deploy.sh`.

- [ ] **Step 7: Validar localmente (sem TLS) e documentar**

Run (build das imagens e subida sem Caddy para não depender de domínio):
```bash
docker compose -f docker-compose.prod.yml build api worker web
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @afilados/db exec prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d api worker web
docker compose -f docker-compose.prod.yml exec api wget -qO- http://localhost:3001/api/v1/health
docker compose -f docker-compose.prod.yml exec worker wget -qO- http://localhost:3002/health
docker compose -f docker-compose.prod.yml exec web wget -qO- http://localhost:3000/login | head -c 200
docker compose -f docker-compose.prod.yml down
```
Expected: `{"ok":true}`, `{"ok":true,"sessions":0}`, HTML da página de login. **Atenção:** este compose de produção usa a porta interna 5432 do container (não conflita com o host); o `.env` local precisa ter `POSTGRES_PASSWORD` e `DOMAIN` para o teste.

README — seção "Deploy no VPS":
````markdown
## Deploy no VPS

1. Instale Docker + Compose plugin; aponte o DNS de `DOMAIN` para o VPS (portas 80/443 abertas).
2. `git clone <repo> && cd afilados && cp .env.example .env` — preencha `POSTGRES_PASSWORD`, `DOMAIN`, `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, `SEED_USER_*`, credenciais.
3. `./deploy.sh` (primeira vez e a cada atualização).
4. Primeiro acesso: `docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @afilados/db seed`.
5. Backups diários em `./backups/` (14 dias). Logs: `docker compose -f docker-compose.prod.yml logs -f worker`.
````

```bash
pnpm format && git add deploy docker-compose.prod.yml deploy.sh .dockerignore .env.example README.md && git commit -m "feat(deploy): Dockerfiles, compose de produção com Caddy/TLS, backup e deploy.sh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec §8 (telas):** `/login` (T2), Visão Geral (T7), Buscar Produtos com abas/sub-abas/filtros/grid/contador (T6), Enviar Ofertas com fila/grupos/intervalo/mídia/template/previsão/lotes (T7), `/config/whatsapp` (T3), `/config/templates` (T5), `/config/shopee` e `/config/conta` (T4), placeholders (T2) ✔. Sidebar e pills (T2) ✔.
- **Spec §9 (deploy):** compose prod com postgres/redis/api/worker/web/caddy, volumes, `deploy.sh` com `migrate deploy`, seed documentado, backup diário (T9) ✔. `.env.example` completo (T1/T9) ✔.
- **Spec §10 (testes web):** Playwright login → busca (mock) → salvar → criar lote (T8) ✔; "conectar WA" com gateway mock não existe no worker — o E2E semeia a sessão `CONNECTED` diretamente (registrado em T8).
- **Spec §11 aceite:** `deploy.sh` entrega HTTPS via Caddy (T9); UI atualiza sem refresh via `RealtimeProvider` (T2/T7) ✔.
- **Dependência `web → core`:** usada só em `batch-form.tsx` (funções puras); anotar no spec de arquitetura na execução da T7 (uma linha em §3 "Regra de dependência").
- **Consistência:** `apiFetch`/`ApiClientError`/`WS_URL` (T1) usados em T2–T7; `useApiMutation` (T3) usado em T4–T7; `StatusPill` (T2) em T3/T7; tipos de `types.ts` (T1) em todos; `SearchQuery`/`searchQuerySchema`/`BatchCreateBody` de `@afilados/shared` (existem desde F1-B T1) ✔.
- **Pendências deferidas (F2+):** alteração de senha, ML/Amazon/Magalu, cupons, dashboard, espelhamento, gestor de tráfego, afiliados; itens Minor da F1-B listados no ledger.
