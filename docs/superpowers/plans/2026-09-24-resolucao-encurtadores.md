# Resolução de Links Encurtados no Espelhamento — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o espelhamento reconhecer links encurtados dos marketplaces suportados (ex.: `meli.la`), resolvendo-os antes da conversão para link de afiliado, e mostrar na interface os motivos de descarte/erro em português curto.

**Architecture:** Módulo novo no worker (`apps/worker/src/mirror/resolve-short-links.ts`) resolve encurtadores de uma allowlist fechada seguindo redirects com validações de segurança, sem tocar `packages/core` (que permanece livre de I/O). O processor `mirror-message.ts` passa a distinguir a URL que aparece no texto (`textUrl`) da URL real do produto (`targetUrl`). A tradução dos motivos de log fica isolada na camada web (`apps/web/src/lib/format.ts`), sem alterar o que é gravado no banco.

**Tech Stack:** TypeScript, Vitest, Prisma, monorepo pnpm (`packages/core`, `apps/worker`, `apps/web`).

## Global Constraints

- Allowlist fechada de encurtadores: `meli.la`, `amzn.to`, `a.co`, `s.shopee.com.br`, `shope.ee`, `s.click.aliexpress.com`, `a.aliexpress.com`. Nenhum outro domínio deve gerar requisição.
- Cada salto de redirect deve ser `https`, não pode ser IP literal nem host privado/`localhost`.
- Máximo de 3 saltos por link; timeout de 5s por link.
- `redirect: 'manual'` — nunca ler o corpo da resposta, só o header `Location`.
- `packages/core` continua sem nenhuma chamada de rede.
- Motivo gravado no banco (`MirrorLog.reason`) continua em código estável (`no-links`, `short-link-unresolved`, etc.); tradução para português acontece só na camada web.
- Motivo não mapeado é exibido cru na interface, nunca escondido atrás de frase genérica.

---

## Task 1: `extractUrls` compartilhado no core

**Files:**
- Modify: `packages/core/src/links.ts:9-24`
- Test: `packages/core/test/links.test.ts`

**Interfaces:**
- Produces: `extractUrls(text: string): string[]` — exportado de `@afilados/core`. Extrai todas as URLs `http(s)` do texto, removendo pontuação final grudada (`.`, `,`, `;`, `:`, `!`, `?`, `)`, `]`). Não deduplica.
- Consumido por: `extractStoreLinks` (mesmo arquivo, Task 1) e pelo novo `resolveShortLinks` (Task 2).

- [ ] **Step 1: Escrever o teste que falha**

Abrir `packages/core/test/links.test.ts` e trocar a linha de import:

```ts
import { buildAffiliateUrl, extractStoreLinks, extractUrls, productKey, rewriteLinks } from '../src/links';
```

Adicionar, logo após o `describe('extractStoreLinks', ...)` existente (antes de `describe('buildAffiliateUrl', ...)`):

```ts
describe('extractUrls', () => {
  it('extrai as URLs do texto removendo pontuação final grudada', () => {
    expect(extractUrls('veja https://meli.la/1h21Ywb. e https://a.co/x2,')).toEqual([
      'https://meli.la/1h21Ywb',
      'https://a.co/x2',
    ]);
  });
  it('vazio sem URLs', () => {
    expect(extractUrls('sem nada aqui')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd apps/worker && pnpm --filter @afilados/core test -- links.test.ts` (ou, na raiz do pacote core: `cd packages/core && pnpm vitest run test/links.test.ts`)

Expected: FAIL — `extractUrls` não está exportado de `../src/links`.

- [ ] **Step 3: Implementar `extractUrls` e refatorar `extractStoreLinks`**

Em `packages/core/src/links.ts`, substituir as linhas 9-24 (da declaração de `URL_RE`/`TRAILING` até o fim de `extractStoreLinks`) por:

```ts
const URL_RE = /https?:\/\/[^\s<>()"'`]+/gi;
const TRAILING = /[.,;:!?)\]]+$/;

export function extractUrls(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((raw) => raw.replace(TRAILING, ''));
}

export function extractStoreLinks(text: string): StoreLink[] {
  const seen = new Set<string>();
  const out: StoreLink[] = [];
  for (const url of extractUrls(text)) {
    if (seen.has(url)) continue;
    const parsed = parseProductUrl(url);
    if (parsed.source === 'UNSUPPORTED') continue;
    seen.add(url);
    out.push({ url, parsed });
  }
  return out;
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd packages/core && pnpm vitest run test/links.test.ts`
Expected: PASS — todos os testes, incluindo os já existentes de `extractStoreLinks` (comportamento preservado) e os dois novos de `extractUrls`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/links.ts packages/core/test/links.test.ts
git commit -m "feat(core): extrai extractUrls de extractStoreLinks para reuso no resolvedor de encurtadores"
```

---

## Task 2: Módulo `resolveShortLinks` no worker

**Files:**
- Create: `apps/worker/src/mirror/resolve-short-links.ts`
- Test: `apps/worker/test/resolve-short-links.test.ts`

**Interfaces:**
- Consumes: `extractUrls` de `@afilados/core` (Task 1).
- Produces:
  - `SHORTENER_HOSTS: Set<string>` — hosts reconhecidos como encurtador oficial de loja.
  - `resolveShortLinks(text: string, deps?: { fetch?: typeof fetch; timeoutMs?: number; maxHops?: number }): Promise<Map<string, string>>` — mapa de URL curta original → URL expandida (só entradas resolvidas com sucesso). Consumido por `mirror-message.ts` (Task 3).

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/worker/test/resolve-short-links.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveShortLinks } from '../src/mirror/resolve-short-links';

function fakeResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null,
    },
    body: undefined,
  } as unknown as Response;
}

describe('resolveShortLinks', () => {
  it('resolve encurtador conhecido e devolve o mapa curta → expandida', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://meli.la/1h21Ywb') {
        return fakeResponse(302, { location: 'https://www.mercadolivre.com.br/p/MLB123456789' });
      }
      throw new Error('url inesperada: ' + url);
    });
    const out = await resolveShortLinks('Confira: https://meli.la/1h21Ywb', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.get('https://meli.la/1h21Ywb')).toBe(
      'https://www.mercadolivre.com.br/p/MLB123456789',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('host fora da allowlist não gera requisição alguma', async () => {
    const fetchMock = vi.fn();
    const out = await resolveShortLinks('link https://bit.ly/xyz aqui', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('texto sem nenhuma URL não gera requisição', async () => {
    const fetchMock = vi.fn();
    const out = await resolveShortLinks('sem link nenhum aqui', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('para de seguir ao estourar o máximo de saltos', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return fakeResponse(302, { location: `https://amzn.to/loop${calls}` });
    });
    const out = await resolveShortLinks('https://amzn.to/loop0', {
      fetch: fetchMock as unknown as typeof fetch,
      maxHops: 3,
    });
    expect(out.has('https://amzn.to/loop0')).toBe(false);
    expect(calls).toBe(3);
  });

  it('timeout resulta em falha da resolução daquele link, sem derrubar os demais', async () => {
    const fetchMock = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      if (url === 'https://amzn.to/slow') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return fakeResponse(302, { location: 'https://www.amazon.com.br/dp/B0AAAAAAAA' });
    });
    const out = await resolveShortLinks('https://amzn.to/slow e https://a.co/OK1', {
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(out.has('https://amzn.to/slow')).toBe(false);
    expect(out.get('https://a.co/OK1')).toBe('https://www.amazon.com.br/dp/B0AAAAAAAA');
  });

  it('rejeita salto para http', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(302, { location: 'http://amazon.com.br/dp/B0X' }),
    );
    const out = await resolveShortLinks('https://amzn.to/insecure', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.has('https://amzn.to/insecure')).toBe(false);
  });

  it('rejeita salto para IP literal / host privado', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(302, { location: 'https://127.0.0.1/admin' }));
    const out = await resolveShortLinks('https://amzn.to/ssrf', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(out.has('https://amzn.to/ssrf')).toBe(false);
  });

  it('usa a mesma extração do core: pontuação final não entra na URL requisitada', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200));
    await resolveShortLinks('Link: https://meli.la/1h21Ywb.', {
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://meli.la/1h21Ywb', expect.anything());
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd apps/worker && pnpm vitest run test/resolve-short-links.test.ts`
Expected: FAIL — não existe `../src/mirror/resolve-short-links`.

- [ ] **Step 3: Implementar `resolve-short-links.ts`**

Criar `apps/worker/src/mirror/resolve-short-links.ts`:

```ts
import { extractUrls } from '@afilados/core';

export const SHORTENER_HOSTS = new Set([
  'meli.la',
  'amzn.to',
  'a.co',
  's.shopee.com.br',
  'shope.ee',
  's.click.aliexpress.com',
  'a.aliexpress.com',
]);

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/i;

function isSafeHop(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
  if (host.includes(':')) return false; // IPv6 literal (inclui ::1)
  if (PRIVATE_HOST_RE.test(host)) return false;
  return true;
}

export interface ResolveShortLinksDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxHops?: number;
}

export async function resolveShortLinks(
  text: string,
  deps: ResolveShortLinksDeps = {},
): Promise<Map<string, string>> {
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  const maxHops = deps.maxHops ?? 3;

  const candidates = new Set<string>();
  for (const raw of extractUrls(text)) {
    try {
      const u = new URL(raw);
      if (SHORTENER_HOSTS.has(u.hostname.replace(/^www\./, ''))) candidates.add(raw);
    } catch {
      // URL inválida: ignora
    }
  }

  const out = new Map<string, string>();
  if (candidates.size === 0) return out;

  for (const shortUrl of candidates) {
    const expanded = await resolveOne(shortUrl, fetchImpl, timeoutMs, maxHops);
    if (expanded) out.set(shortUrl, expanded);
  }
  return out;
}

async function resolveOne(
  startUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxHops: number,
): Promise<string | undefined> {
  let current: URL;
  try {
    current = new URL(startUrl);
  } catch {
    return undefined;
  }
  if (!isSafeHop(current)) return undefined;

  for (let hop = 0; hop < maxHops; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
    void res.body?.cancel?.().catch(() => {});

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return undefined;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return undefined;
      }
      if (!isSafeHop(next)) return undefined;
      current = next;
      continue;
    }

    if (res.status >= 200 && res.status < 300) {
      return current.toString();
    }

    return undefined;
  }
  return undefined; // estourou maxHops sem chegar a uma resposta final
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd apps/worker && pnpm vitest run test/resolve-short-links.test.ts`
Expected: PASS — todos os 8 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/mirror/resolve-short-links.ts apps/worker/test/resolve-short-links.test.ts
git commit -m "feat(worker): resolve links encurtados de lojas suportadas com allowlist e proteção contra SSRF"
```

---

## Task 3: Integrar no processor de espelhamento

**Files:**
- Modify: `apps/worker/src/processors/mirror-message.ts` (arquivo inteiro — a maior parte do corpo muda)
- Test: `apps/worker/test/mirror-message.test.ts`

**Interfaces:**
- Consumes: `resolveShortLinks`, `SHORTENER_HOSTS` de `../mirror/resolve-short-links` (Task 2); `extractUrls`, `parseProductUrl`, `StoreLink` de `@afilados/core` (Task 1 e já existentes).
- Produces: `MirrorMessageDeps.resolveShortLinks?: (text: string) => Promise<Map<string, string>>` (novo campo opcional, injetável em teste). `MirrorMessageResult` ganha o motivo `'short-link-unresolved'` no caso `discarded`.

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/worker/test/mirror-message.test.ts`, adicionar três testes ao final do `describe('mirrorMessage processor', ...)`, antes do `});` de fechamento (depois do teste `'regra TEMPLATE com link Amazon faz fallback para CLONE com template->clone'`):

```ts
  it('mensagem com link encurtado (meli.la) é espelhada com a URL curta substituída pelo link de afiliado', async () => {
    await prisma.marketplaceConnection.create({
      data: {
        tenantId,
        kind: 'MERCADOLIVRE',
        encryptedCredentials: encryptJson({ mattWord: 'minhaid', mattTool: '12345678' }),
        status: 'OK',
      },
    });
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const jobData: MirrorMessageJob = {
      tenantId,
      ruleId: rule.id,
      sessionId,
      sourceJid: 's@g.us',
      msgId: 'M-short',
      message: { message: { conversation: 'Oferta: https://meli.la/1h21Ywb' } },
    };
    const deps: MirrorMessageDeps = {
      gateway: fakeGateway,
      sleep: async () => {},
      resolveShortLinks: async () =>
        new Map([
          ['https://meli.la/1h21Ywb', 'https://produto.mercadolivre.com.br/MLB-123456789'],
        ]),
    };
    const res = await mirrorMessage(deps, jobData);
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });
    expect(fakeGateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't1@g.us',
      expect.objectContaining({
        kind: 'text',
        text: 'Oferta: https://produto.mercadolivre.com.br/MLB-123456789?matt_word=minhaid&matt_tool=12345678',
      }),
      { dedupeEcho: true },
    );

    const log = await prisma.mirrorLog.findFirstOrThrow({
      where: { ruleId: rule.id, targetJid: 't1@g.us' },
    });
    expect(log).toMatchObject({ status: 'MIRRORED', productKey: 'MERCADOLIVRE:MLB123456789' });
  });

  it('mensagem só com encurtador que não resolve é descartada com short-link-unresolved', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us'],
        enabled: true,
      },
    });
    const jobData: MirrorMessageJob = {
      tenantId,
      ruleId: rule.id,
      sessionId,
      sourceJid: 's@g.us',
      msgId: 'M-unresolved',
      message: { message: { conversation: 'Oferta: https://amzn.to/quebrado' } },
    };
    const deps: MirrorMessageDeps = {
      gateway: fakeGateway,
      sleep: async () => {},
      resolveShortLinks: async () => new Map(),
    };
    const res = await mirrorMessage(deps, jobData);
    expect(res).toEqual({ outcome: 'discarded', reason: 'short-link-unresolved' });
    expect(fakeGateway.sendMessage).not.toHaveBeenCalled();

    const log = await prisma.mirrorLog.findFirstOrThrow({ where: { ruleId: rule.id } });
    expect(log).toMatchObject({ status: 'DISCARDED', reason: 'short-link-unresolved' });
  });

  it('link completo funcionando + encurtador que falha: espelha e anexa o motivo, mantendo o link curto intacto', async () => {
    const rule = await prisma.mirrorRule.create({
      data: {
        tenantId,
        sessionId,
        sourceJids: ['s@g.us'],
        targetJids: ['t1@g.us'],
        mode: 'CLONE',
        mediaMode: 'PREVIEW',
        enabled: true,
      },
    });
    const jobData: MirrorMessageJob = {
      tenantId,
      ruleId: rule.id,
      sessionId,
      sourceJid: 's@g.us',
      msgId: 'M-partial',
      message: {
        message: {
          conversation:
            'Amazon: https://www.amazon.com.br/dp/B0PARTIAL1 e encurtado: https://amzn.to/quebrado',
        },
      },
    };
    const deps: MirrorMessageDeps = {
      gateway: fakeGateway,
      sleep: async () => {},
      resolveShortLinks: async () => new Map(),
    };
    const res = await mirrorMessage(deps, jobData);
    expect(res).toEqual({ outcome: 'mirrored', count: 1 });

    const log = await prisma.mirrorLog.findFirstOrThrow({
      where: { ruleId: rule.id, targetJid: 't1@g.us' },
    });
    expect(log.status).toBe('MIRRORED');
    expect(log.reason).toBe('short-link-unresolved');

    expect(fakeGateway.sendMessage).toHaveBeenCalledWith(
      sessionId,
      't1@g.us',
      expect.objectContaining({
        kind: 'text',
        text: expect.stringContaining('https://amzn.to/quebrado'),
      }),
      { dedupeEcho: true },
    );
  });
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd apps/worker && pnpm vitest run test/mirror-message.test.ts`
Expected: FAIL — `MirrorMessageDeps` não tem `resolveShortLinks`, e `meli.la`/`amzn.to` continuam caindo em `no-links` (os 3 testes novos falham; os 4 antigos continuam passando).

- [ ] **Step 3: Reescrever `mirror-message.ts`**

Substituir o conteúdo inteiro de `apps/worker/src/processors/mirror-message.ts` por:

```ts
import type { Job } from 'bullmq';
import { DelayedError } from 'bullmq';
import pino from 'pino';
import { prisma, decryptJson } from '@afilados/db';
import {
  extractStoreLinks,
  extractUrls,
  hasImage,
  isWithinOperatingWindow,
  nextWindowOpen,
  parseProductUrl,
  pickText,
  productKey,
  renderTemplate,
  rewriteLinks,
  generateSubId,
  type StoreLink,
} from '@afilados/core';
import {
  getAdapter,
  type AliexpressCredentials,
  type AnyAdapter,
  type MarketplaceAdapter,
  type ShopeeCredentials,
} from '@afilados/marketplaces';
import {
  hasTagCredentials,
  type MarketplaceKind,
  type MirrorMessageJob,
  type ProductData,
  type TagCredentials,
} from '@afilados/shared';

import { publishEvent } from '../lib/events';
import { getRedis } from '../lib/redis';
import { TokenBucket, jitter, waitForToken } from '../lib/rate-limit';
import type { OutgoingMessage, WhatsAppGateway } from '../wa/gateway';
import {
  resolveShortLinks as resolveShortLinksImpl,
  SHORTENER_HOSTS,
} from '../mirror/resolve-short-links';

const log = pino({ name: 'mirror-message' });

export interface MirrorMessageDeps {
  gateway: WhatsAppGateway;
  getAdapter?: (kind: MarketplaceKind) => AnyAdapter;
  downloadMedia?: (sessionId: string, message: unknown) => Promise<Buffer>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  bucketFor?: (sessionId: string, ratePerMin: number) => { take(): Promise<number> };
  resolveShortLinks?: (text: string) => Promise<Map<string, string>>;
}

export type MirrorMessageResult =
  | { outcome: 'mirrored'; count: number }
  | { outcome: 'discarded'; reason: 'no-links' | 'short-link-unresolved' }
  | { outcome: 'skipped'; reason: 'rule-disabled' | 'missing' }
  | { outcome: 'rescheduled'; runAt: Date };

interface ResolvedLink {
  textUrl: string;
  targetUrl: string;
  parsed: StoreLink['parsed'];
}

export async function mirrorMessage(
  deps: MirrorMessageDeps,
  jobData: MirrorMessageJob,
): Promise<MirrorMessageResult> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rng = deps.rng ?? Math.random;
  const adapterGetter = deps.getAdapter ?? getAdapter;
  const downloadMedia =
    deps.downloadMedia ?? ((s: string, m: unknown) => deps.gateway.downloadMedia(s, m));
  const bucketFor =
    deps.bucketFor ??
    ((sessionId: string, rate: number) =>
      new TokenBucket(getRedis(), `wa:rate:${sessionId}`, rate));
  const resolveShortLinks = deps.resolveShortLinks ?? resolveShortLinksImpl;

  const rule = await prisma.mirrorRule.findUnique({
    where: { id: jobData.ruleId },
    include: { template: true },
  });
  if (!rule || !rule.enabled) return { outcome: 'skipped', reason: 'rule-disabled' };

  const tenantId = rule.tenantId;
  const text = pickText(jobData.message);
  const storeLinks = extractStoreLinks(text);
  const expansions = await resolveShortLinks(text);

  const resolvedLinks: ResolvedLink[] = storeLinks.map((l) => ({
    textUrl: l.url,
    targetUrl: l.url,
    parsed: l.parsed,
  }));
  for (const [shortUrl, expandedUrl] of expansions) {
    const parsed = parseProductUrl(expandedUrl);
    if (parsed.source !== 'UNSUPPORTED') {
      resolvedLinks.push({ textUrl: shortUrl, targetUrl: expandedUrl, parsed });
    }
  }

  const candidateShortUrls = new Set(
    extractUrls(text).filter((u) => {
      try {
        return SHORTENER_HOSTS.has(new URL(u).hostname.replace(/^www\./, ''));
      } catch {
        return false;
      }
    }),
  );
  const hasUnresolvedShortLink = [...candidateShortUrls].some((u) => !expansions.has(u));

  if (resolvedLinks.length === 0) {
    const reason: 'no-links' | 'short-link-unresolved' = hasUnresolvedShortLink
      ? 'short-link-unresolved'
      : 'no-links';
    for (const targetJid of rule.targetJids) {
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'DISCARDED',
          reason,
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'DISCARDED',
        reason,
        targetJid,
      });
    }
    return { outcome: 'discarded', reason };
  }

  const [windowRow, settingsRows, connections] = await Promise.all([
    prisma.operatingWindow.findUnique({ where: { tenantId } }),
    prisma.setting.findMany({ where: { tenantId } }),
    prisma.marketplaceConnection.findMany({ where: { tenantId } }),
  ]);
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value])) as Record<
    string,
    unknown
  >;
  const ratePerMin = Number(settings.globalRateLimitPerMin ?? 6);
  const window = windowRow
    ? {
        startTime: windowRow.startTime,
        endTime: windowRow.endTime,
        timezone: windowRow.timezone,
        enabled: windowRow.enabled,
      }
    : { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true };

  const t = now();
  if (!isWithinOperatingWindow(t, window)) {
    const runAt = nextWindowOpen(t, window);
    return { outcome: 'rescheduled', runAt };
  }

  const connMap = new Map(connections.map((c) => [c.kind, c]));
  const replacements = new Map<string, string>();
  const convertedByTarget = new Map<string, string>();
  const unsupportedStores = new Set<string>();

  for (const storeLink of resolvedLinks) {
    const kind = storeLink.parsed.source;
    const conn = connMap.get(kind);
    try {
      if (kind === 'SHOPEE') {
        if (conn?.encryptedCredentials) {
          const creds = decryptJson<ShopeeCredentials>(Buffer.from(conn.encryptedCredentials));
          const subId = generateSubId('{yyyyMMdd}-mirror-' + rule.id, {
            now: t,
            batchId: rule.id,
            timezone: window.timezone,
          });
          const adapter = adapterGetter('SHOPEE') as MarketplaceAdapter<ShopeeCredentials>;
          const affLink = await adapter.toAffiliateLink(creds, storeLink.targetUrl, subId);
          replacements.set(storeLink.textUrl, affLink);
          convertedByTarget.set(storeLink.targetUrl, affLink);
        } else {
          replacements.set(storeLink.textUrl, storeLink.textUrl);
          convertedByTarget.set(storeLink.targetUrl, storeLink.targetUrl);
          unsupportedStores.add('SHOPEE');
        }
      } else if (kind === 'ALIEXPRESS') {
        if (conn?.encryptedCredentials) {
          const creds = decryptJson<AliexpressCredentials>(Buffer.from(conn.encryptedCredentials));
          const subId = generateSubId('{yyyyMMdd}-mirror-' + rule.id, {
            now: t,
            batchId: rule.id,
            timezone: window.timezone,
          });
          const adapter = adapterGetter('ALIEXPRESS') as MarketplaceAdapter<AliexpressCredentials>;
          const affLink = await adapter.toAffiliateLink(creds, storeLink.targetUrl, subId);
          replacements.set(storeLink.textUrl, affLink);
          convertedByTarget.set(storeLink.targetUrl, affLink);
        } else {
          replacements.set(storeLink.textUrl, storeLink.textUrl);
          convertedByTarget.set(storeLink.targetUrl, storeLink.targetUrl);
          unsupportedStores.add('ALIEXPRESS');
        }
      } else {
        if (conn?.encryptedCredentials) {
          const creds = decryptJson<TagCredentials>(Buffer.from(conn.encryptedCredentials));
          if (hasTagCredentials(kind, creds)) {
            const adapter = adapterGetter(kind) as MarketplaceAdapter<TagCredentials>;
            const affLink = await adapter.toAffiliateLink(creds, storeLink.targetUrl);
            replacements.set(storeLink.textUrl, affLink);
            convertedByTarget.set(storeLink.targetUrl, affLink);
          } else {
            replacements.set(storeLink.textUrl, storeLink.textUrl);
            convertedByTarget.set(storeLink.targetUrl, storeLink.targetUrl);
            unsupportedStores.add(kind);
          }
        } else {
          replacements.set(storeLink.textUrl, storeLink.textUrl);
          convertedByTarget.set(storeLink.targetUrl, storeLink.targetUrl);
          unsupportedStores.add(kind);
        }
      }
    } catch {
      replacements.set(storeLink.textUrl, storeLink.textUrl);
      convertedByTarget.set(storeLink.targetUrl, storeLink.targetUrl);
      unsupportedStores.add(kind);
    }
  }

  const prodKey = productKey(resolvedLinks[0]!.parsed, resolvedLinks[0]!.targetUrl);
  let effectiveMode: 'CLONE' | 'TEMPLATE' = 'CLONE';
  let fallbackReason: string | null = null;
  let templateProducts: { product: ProductData; convertedUrl: string }[] = [];

  let template = rule.template;
  if (rule.mode === 'TEMPLATE') {
    if (!template) {
      template =
        (await prisma.template.findFirst({ where: { tenantId, isDefault: true } })) ??
        (await prisma.template.findFirst({ where: { tenantId } }));
    }
    const allShopee = resolvedLinks.every((l) => l.parsed.source === 'SHOPEE');
    const shopeeConn = connMap.get('SHOPEE');
    if (allShopee && template && shopeeConn?.encryptedCredentials) {
      try {
        const creds = decryptJson<ShopeeCredentials>(Buffer.from(shopeeConn.encryptedCredentials));
        const adapter = adapterGetter('SHOPEE') as MarketplaceAdapter<ShopeeCredentials>;
        const fetched = await adapter.fetchByUrls(
          creds,
          resolvedLinks.map((l) => l.targetUrl),
        );

        if (fetched.length > 0) {
          effectiveMode = 'TEMPLATE';
          templateProducts = fetched.map((p) => ({
            product: p,
            convertedUrl: convertedByTarget.get(p.originalUrl) ?? p.originalUrl,
          }));
        } else {
          fallbackReason = 'template->clone';
        }
      } catch {
        fallbackReason = 'template->clone';
      }
    } else {
      fallbackReason = 'template->clone';
    }
  }

  const outgoingMessages: OutgoingMessage[] = [];
  if (effectiveMode === 'CLONE') {
    const newText = rewriteLinks(text, replacements);
    if (rule.mediaMode === 'IMAGE' && hasImage(jobData.message)) {
      const imageBuffer = await downloadMedia(jobData.sessionId, jobData.message);
      outgoingMessages.push({ kind: 'image', imageBuffer, caption: newText });
    } else {
      // Sem dado real de produto pra título/thumbnail aqui (CLONE não busca na API do
      // marketplace) — mandar 'preview' com campos em branco faz o WhatsApp aceitar esse
      // linkPreview vazio como definitivo e NÃO gerar a prévia real a partir do link, virando
      // uma mensagem com o link pelado. Texto simples deixa o WhatsApp buscar a prévia sozinho.
      outgoingMessages.push({ kind: 'text', text: newText });
    }
  } else if (template) {
    for (const item of templateProducts) {
      const body = renderTemplate(template.body, item.product, {
        affiliateLink: item.convertedUrl,
        now: t.toISOString(),
      });
      const firstImg = item.product.images?.[0];
      if (rule.mediaMode === 'IMAGE' && firstImg) {
        outgoingMessages.push({ kind: 'image', imageUrl: firstImg, caption: body });
      } else {
        outgoingMessages.push({
          kind: 'preview',
          text: body,
          title: item.product.title,
          description: `R$ ${Number(item.product.price).toFixed(2).replace('.', ',')}`,
          thumbnailUrl: firstImg ?? '',
          url: item.convertedUrl,
        });
      }
    }
  }

  const bucket = bucketFor(rule.sessionId, ratePerMin);
  const dedupSince = new Date(t.getTime() - rule.dedupHours * 3600_000);
  let mirroredCount = 0;

  for (const targetJid of rule.targetJids) {
    // Dedup check
    const dup = await prisma.mirrorLog.findFirst({
      where: {
        tenantId,
        targetJid,
        productKey: prodKey,
        status: 'MIRRORED',
        createdAt: { gte: dedupSince },
      },
    });
    if (dup) {
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'DISCARDED',
          reason: 'duplicate',
          productKey: prodKey,
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'DISCARDED',
        reason: 'duplicate',
        targetJid,
      });
      continue;
    }

    await waitForToken(bucket, sleep);
    await sleep(jitter(2000, 0.15, rng));

    try {
      let lastMessageId: string | undefined;
      for (const msg of outgoingMessages) {
        const res = await deps.gateway.sendMessage(rule.sessionId, targetJid, msg, {
          dedupeEcho: true,
        });
        lastMessageId = res.messageId;
      }
      mirroredCount++;
      const extraReasons: string[] = [];
      if (fallbackReason) extraReasons.push(fallbackReason);
      if (unsupportedStores.size > 0) {
        extraReasons.push(`unsupported-store:${Array.from(unsupportedStores).join(',')}`);
      }
      if (hasUnresolvedShortLink) extraReasons.push('short-link-unresolved');
      const reason = extraReasons.length > 0 ? extraReasons.join(';') : null;
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'MIRRORED',
          reason,
          productKey: prodKey,
          waMessageId: lastMessageId ?? null,
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'MIRRORED',
        ...(reason ? { reason } : {}),
        targetJid,
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log.warn({ ruleId: rule.id, targetJid, errorMsg }, 'falha ao espelhar mensagem');
      const logRow = await prisma.mirrorLog.create({
        data: {
          tenantId,
          ruleId: rule.id,
          sourceJid: jobData.sourceJid,
          sourceMsgId: jobData.msgId,
          targetJid,
          status: 'ERROR',
          reason: errorMsg,
          productKey: prodKey,
        },
      });
      await publishEvent(tenantId, {
        type: 'mirror.log',
        ruleId: rule.id,
        logId: logRow.id,
        status: 'ERROR',
        reason: errorMsg,
        targetJid,
      });
    }
  }

  return { outcome: 'mirrored', count: mirroredCount };
}

export function processMirrorMessage(deps: MirrorMessageDeps) {
  return async (job: Job<MirrorMessageJob>) => {
    const r = await mirrorMessage(deps, job.data);
    if (r.outcome === 'rescheduled') {
      const delay = Math.max(1_000, r.runAt.getTime() - Date.now());
      await job.moveToDelayed(Date.now() + delay, job.token);
      throw new DelayedError();
    }
  };
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd apps/worker && pnpm vitest run test/mirror-message.test.ts`
Expected: PASS — os 4 testes antigos (comportamento preservado) e os 3 novos.

- [ ] **Step 5: Rodar a suíte inteira do worker (typecheck + testes relacionados)**

Run: `cd apps/worker && pnpm typecheck && pnpm vitest run test/mirror-message.test.ts test/mirror-listener.test.ts test/resolve-short-links.test.ts`
Expected: PASS em tudo, `tsc --noEmit` sem erro nos arquivos tocados.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/processors/mirror-message.ts apps/worker/test/mirror-message.test.ts
git commit -m "feat(worker): espelhamento resolve links encurtados antes de gerar o link de afiliado"
```

---

## Task 4: Motivos em português na interface

**Files:**
- Modify: `apps/web/src/lib/format.ts`
- Modify: `apps/web/src/components/mirror/log-table.tsx:1-3,86-88`
- Test: `apps/web/test/format.test.ts`

**Interfaces:**
- Produces: `translateMirrorReason(reason: string | null | undefined): string | null`, exportado de `@/lib/format`.
- Consumed by: `MirrorLogTable` (`apps/web/src/components/mirror/log-table.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/web/test/format.test.ts`, trocar a linha de import e adicionar o describe:

```ts
import { formatBRL, statusTone, translateMirrorReason } from '@/lib/format';
```

Adicionar ao final do arquivo, antes do `});` de fechamento do `describe('format', ...)`:

```ts
  it('translateMirrorReason: códigos conhecidos', () => {
    expect(translateMirrorReason('no-links')).toBe('Sem links');
    expect(translateMirrorReason('short-link-unresolved')).toBe('Link encurtado não abriu');
    expect(translateMirrorReason('duplicate')).toBe('Duplicado');
    expect(translateMirrorReason('template->clone')).toBe('Enviado como cópia');
    expect(translateMirrorReason('WA_NOT_CONNECTED')).toBe('WhatsApp desconectado');
  });
  it('translateMirrorReason: unsupported-store com uma loja', () => {
    expect(translateMirrorReason('unsupported-store:AMAZON')).toBe('Sem credencial: Amazon');
  });
  it('translateMirrorReason: unsupported-store com várias lojas', () => {
    expect(translateMirrorReason('unsupported-store:AMAZON,MERCADOLIVRE')).toBe(
      'Sem credencial: Amazon, Mercado Livre',
    );
  });
  it('translateMirrorReason: combina múltiplos motivos separados por ;', () => {
    expect(translateMirrorReason('template->clone;unsupported-store:AMAZON')).toBe(
      'Enviado como cópia, Sem credencial: Amazon',
    );
  });
  it('translateMirrorReason: código não mapeado passa intacto', () => {
    expect(translateMirrorReason('Connection Timed Out unexpectedly')).toBe(
      'Connection Timed Out unexpectedly',
    );
  });
  it('translateMirrorReason: null/undefined vira null', () => {
    expect(translateMirrorReason(null)).toBeNull();
    expect(translateMirrorReason(undefined)).toBeNull();
  });
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd apps/web && pnpm vitest run test/format.test.ts`
Expected: FAIL — `translateMirrorReason` não existe em `@/lib/format`.

- [ ] **Step 3: Implementar `translateMirrorReason`**

Em `apps/web/src/lib/format.ts`, adicionar ao final do arquivo:

```ts
const MIRROR_REASON_LABELS: Record<string, string> = {
  'no-links': 'Sem links',
  'short-link-unresolved': 'Link encurtado não abriu',
  duplicate: 'Duplicado',
  'template->clone': 'Enviado como cópia',
  WA_NOT_CONNECTED: 'WhatsApp desconectado',
  'No sessions': 'Falha de sessão',
  'Connection Closed': 'Conexão caiu',
  'Timed Out': 'Tempo esgotado',
};

const MIRROR_STORE_LABELS: Record<string, string> = {
  AMAZON: 'Amazon',
  MERCADOLIVRE: 'Mercado Livre',
  MAGALU: 'Magalu',
  SHOPEE: 'Shopee',
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Awin',
};

function translateSingleMirrorReason(token: string): string {
  const trimmed = token.trim();
  if (MIRROR_REASON_LABELS[trimmed]) return MIRROR_REASON_LABELS[trimmed];
  const match = trimmed.match(/^unsupported-store:(.+)$/);
  if (match) {
    const stores = match[1]!
      .split(',')
      .map((s) => MIRROR_STORE_LABELS[s] ?? s)
      .join(', ');
    return `Sem credencial: ${stores}`;
  }
  return trimmed;
}

export function translateMirrorReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.split(';').map(translateSingleMirrorReason).join(', ');
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd apps/web && pnpm vitest run test/format.test.ts`
Expected: PASS — todos os testes de `format.test.ts`.

- [ ] **Step 5: Ligar na tabela de logs**

Em `apps/web/src/components/mirror/log-table.tsx`, trocar a linha 2 (`import { formatDateTime } from '@/lib/format';`) por:

```tsx
import { formatDateTime, translateMirrorReason } from '@/lib/format';
```

E trocar a linha 87 (`{log.reason ?? (log.waMessageId ? \`WA ID: ${log.waMessageId}\` : '-')}`) por:

```tsx
                    {translateMirrorReason(log.reason) ??
                      (log.waMessageId ? `WA ID: ${log.waMessageId}` : '-')}
```

- [ ] **Step 6: Rodar typecheck da web**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS, sem erro em `log-table.tsx` ou `format.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/format.ts apps/web/src/components/mirror/log-table.tsx apps/web/test/format.test.ts
git commit -m "feat(web): motivos do log de espelhamento exibidos em português curto"
```

---

## Verificação final

- [ ] **Rodar a suíte completa do monorepo**

Run: `cd D:/apps/afilados && pnpm -r typecheck && pnpm -r test`
Expected: tudo verde, sem regressão nos pacotes `core`, `worker` e `web`.

- [ ] **Rebuild e restart do worker no Docker (ambiente do dono)**

```bash
docker compose build worker
docker compose up -d worker
docker logs afilados-worker-1 --tail 20
```

Expected: `"msg":"worker iniciado"` sem erro de inicialização.

- [ ] **Teste manual ponta a ponta**

Colar no grupo de origem configurado uma oferta real com link `meli.la` (ou outro da allowlist) e conferir na tabela `MirrorLog` (ou na tela de espelhamento) que o status virou `MIRRORED`, com a URL substituída pelo link de afiliado no grupo de destino.
