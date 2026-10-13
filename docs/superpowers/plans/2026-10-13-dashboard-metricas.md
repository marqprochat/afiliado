# Dashboard e Métricas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o placeholder de `/dashboard` por um módulo analítico (grupos, envios, produtos, cliques, espelhamento/automações) alimentado por três tabelas novas de eventos/snapshots e seis rotas `GET /api/v1/metrics/*`.

**Architecture:** Contrato único em `@afilados/shared` (schema zod da query, tipos de resposta e helpers de fuso `America/Sao_Paulo`) consumido por api e web. O worker grava `GroupMemberEvent` a partir do `group-participants.update` do Baileys e `GroupSnapshot` diário (job BullMQ) e no `syncGroups`; a api grava `LinkClickEvent` na resolução pública do slug usada por `/g/[slug]`. A api agrega com SQL direto nas tabelas operacionais (uma função por painel) e a web renderiza seções independentes com TanStack Query + Recharts, estado de filtro na URL.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, BullMQ 5 (`upsertJobScheduler`), Baileys 6.7.24, Fastify + zod, Next.js 15 / React 19, TanStack Query 5, Recharts 3, Tailwind 4/shadcn, Vitest + Testing Library, Playwright.

Spec: `docs/superpowers/specs/2026-10-13-dashboard-metricas-design.md`

## Global Constraints

- Monitoramento de grupos restrito a `WaGroup` com `botIsAdmin = true`.
- Agregados pré-calculados (`MetricDaily`), exportação CSV/PDF e alertas automáticos estão **fora** da v1.
- Histórico de grupos existe só a partir do deploy; a UI mostra "Histórico de movimentação disponível a partir de DD/MM/AAAA".
- Todas as entidades novas têm `tenantId` → `Tenant` com `onDelete: Cascade`; `LinkClickEvent.groupLinkId` → `GroupLink` com `onDelete: Cascade`.
- `GroupMemberEvent.participantJid` guarda só o JID bruto (sem nome nem telefone formatado).
- `GroupMemberAction`: `JOIN`, `LEAVE`, `REMOVED`, `ADDED`, `PROMOTED`, `DEMOTED`.
- `GroupSnapshot.date` truncada para 00:00:00 em `America/Sao_Paulo`; `@@unique([sessionId, groupJid, date])`.
- Retenção de `GroupMemberEvent` e `LinkClickEvent` (e snapshots): 12 meses, configurável.
- Gravação de evento no worker sempre em `try/catch`: erro de banco nunca derruba o handler do gateway Baileys.
- Job BullMQ diário à meia-noite de `America/Sao_Paulo` + snapshot também no `syncGroups`.
- Rotas sob `/api/v1/metrics`, autenticadas, validadas com zod; `from`/`to` ISO 8601 obrigatórios, intervalo máximo **366 dias**; `groupJid` opcional, de outro tenant → **404**.
- Uma função de agregação por painel; agrupamento diário em `America/Sao_Paulo`; todo acesso filtra por `tenantId`.
- Web: filtros `period` (`today`, `7d`, `30d` padrão, `90d`, `custom`), `from`, `to`, `groupJid` na URL; `useQuery` com `staleTime: 60000`; esqueleto, card de erro com "Tentar novamente" e estado vazio **por seção**; modo claro e escuro; paleta acessível.
- Baileys fica em **6.7.24** (não atualizar).
- Texto da UI em português. Testes web em `apps/web/test`, api em `apps/api/test`, worker em `apps/worker/test`, db em `packages/db/test`, shared em `packages/shared/test`.
- Testes de api, worker e db precisam de Postgres + Redis: rodar no servidor Linux com `.superpowers/sdd/remote.sh` (`up` e `setup` uma vez por máquina; depois `run <comando>`; rode `setup` de novo sempre que o schema Prisma mudar). Testes de `packages/shared` e `apps/web` rodam localmente.
- Antes de cada commit, rode `pnpm exec prettier --write` nos arquivos da tarefa (o repo usa `prettier --check .` no `pnpm lint`).
- A árvore de trabalho principal tem alterações alheias a esta feature: **nunca** `git stash`, `git reset`, `git checkout --` nem `git add` de arquivos fora da sua tarefa. Cada trilha trabalha numa worktree própria (ver "Branches e worktrees").
- Commits terminam com:
  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  ```
- Antes de declarar concluído: validar no Docker (Task 17).

## Trilhas, donos e dependências

| Trilha | Dono sugerido | Tarefas |
| --- | --- | --- |
| A: dados e coleta | agente Prisma | 2, 3, 4, 5 |
| B: serviço e rotas de métricas | agente Programador | 1, 6, 7, 8, 9, 10 |
| C: interface `/dashboard` | agente FrontEnd Designer | 11, 12, 13, 14, 15 |
| D: integração, PR e Docker | agente Github | 16, 17 |

```
T1 (B: contrato shared) ─┬─► T2 (A: schema) ─┬─► T3 ─► T4 ─► T5          (A)
                         │                   └─► T8 ─► T9 ─► T10         (B, depois de T2)
                         ├─► T6 ─► T7 ───────────────►┘                  (B, não depende de T2)
                         └─► T11 ─► T12 ─► T13 ─► T14 ─► T15             (C)
T5 + T10 + T15 ─► T16 (D: integrar + PR) ─► T17 (D: Docker + merge)
```

- **T1 é o primeiro e único bloqueante comum**: define os tipos de `@afilados/shared` que B e C consomem.
- Depois de T1, **A e B rodam em paralelo**. Em B, T6 e T7 só leem tabelas que já existem; T8 lê `GroupMemberEvent`/`GroupSnapshot`/`LinkClickEvent` e por isso precisa do commit de T2 (rode `git merge feat/dashboard-metricas-a` na worktree de B quando T2 estiver commitado).
- C depende apenas de T1 (os testes da web mockam `apiFetch`). O E2E (T15) é escrito em C e executado em T17, contra o stack real.
- D começa quando A, B e C terminaram.

## Branches e worktrees

A branch de integração é `feat/dashboard-metricas` (já contém a spec e este plano). Cada trilha trabalha na sua branch, numa worktree separada (a árvore principal tem alterações de outra tarefa e não pode ser mexida):

```bash
git worktree add ../afilados-metricas-b -b feat/dashboard-metricas-b feat/dashboard-metricas   # Trilha B (faz T1 primeiro)
# depois que T1 estiver commitado em feat/dashboard-metricas-b:
git worktree add ../afilados-metricas-a -b feat/dashboard-metricas-a feat/dashboard-metricas-b # Trilha A
git worktree add ../afilados-metricas-c -b feat/dashboard-metricas-c feat/dashboard-metricas-b # Trilha C
```

Em cada worktree nova rode `pnpm install` antes de começar. O `remote.sh` usa `git rev-parse --show-toplevel`, então rodá-lo de dentro da worktree sincroniza aquela worktree. Ele vive em `.superpowers/sdd/remote.sh` (git-ignored): copie-o da árvore principal para a worktree (`mkdir -p .superpowers/sdd && cp ../afilados/.superpowers/sdd/remote.sh .superpowers/sdd/`). Duas trilhas não podem rodar `remote.sh` ao mesmo tempo (o diretório remoto `~/afilados-ml` é único): combinem a vez pelo Maestri.

## File Structure

| Arquivo | Trilha | Responsabilidade |
| --- | --- | --- |
| `packages/shared/src/metrics.ts` | B (T1) | schema zod da query, tipos de resposta dos 6 painéis, helpers de fuso/datas, `metricsDelta` |
| `packages/shared/src/index.ts` | B (T1) | re-exporta `./metrics` |
| `packages/shared/src/queues.ts` | A (T4) | `QUEUE_METRICS_DAILY`, `MetricsDailyJob` |
| `packages/db/prisma/schema.prisma` | A (T2) | enum `GroupMemberAction`, modelos `GroupMemberEvent`, `GroupSnapshot`, `LinkClickEvent` |
| `packages/db/prisma/migrations/20261013120000_metrics_events/migration.sql` | A (T2) | migration SQL |
| `packages/db/src/index.ts` | A (T2) | novos modelos em `TENANT_MODELS` |
| `apps/worker/src/wa/gateway.ts`, `baileys-gateway.ts` | A (T3) | `author` no `GroupParticipantsUpdateEvent` |
| `apps/worker/src/metrics/group-member-recorder.ts` | A (T3) | mapeia ação → `GroupMemberAction` e grava idempotente |
| `apps/worker/src/metrics/group-snapshots.ts` | A (T4) | `snapshotGroups`, `purgeOldMetrics` |
| `apps/worker/src/processors/metrics-daily.ts` | A (T4) | processor do job diário + `scheduleMetricsDaily` |
| `apps/worker/src/wa/session-manager.ts` | A (T4) | snapshot ao fim do `syncGroups` |
| `apps/worker/src/config.ts`, `apps/worker/src/main.ts` | A (T3, T4) | `METRICS_RETENTION_DAYS`; liga recorder, worker e agendamento |
| `apps/api/src/lib/link-clicks.ts` | A (T5) | `recordLinkClick` |
| `apps/api/src/routes/public-group-links.ts` | A (T5) | grava o clique na resolução do slug (inclusive via cache) |
| `apps/api/test/metrics-fixtures.ts` | B (T6) | fábricas de dados para os testes de métricas |
| `apps/api/src/lib/metrics/common.ts` | B (T6) | SQL de fuso, validação de `groupJid`, `fillDays`, `pct`, `getTrackingSince`, `adminGroupsOf` |
| `apps/api/src/lib/metrics/sends.ts` | B (T6) | `getSendsMetrics` |
| `apps/api/src/lib/metrics/products.ts`, `automation.ts` | B (T7) | `getProductsMetrics`, `getAutomationMetrics` |
| `apps/api/src/lib/metrics/groups.ts`, `clicks.ts` | B (T8) | `getGroupsMetrics`, `getClicksMetrics` |
| `apps/api/src/lib/metrics/overview.ts` | B (T9) | `getOverviewMetrics` |
| `apps/api/src/routes/metrics.ts`, `apps/api/src/app.ts` | B (T10) | 6 rotas + registro |
| `apps/web/src/lib/metrics-filters.ts` | C (T11) | parse/serialização dos filtros da URL |
| `apps/web/src/lib/use-metrics-filters.ts` | C (T11) | hook de filtros sincronizado com a URL |
| `apps/web/src/lib/metrics-queries.ts` | C (T11) | hooks `useMetrics*` |
| `apps/web/package.json`, `pnpm-lock.yaml` | C (T11) | dependência `recharts` |
| `apps/web/src/lib/metrics-format.ts` | C (T12) | formatação pt-BR (números, %, datas) e rótulos de marketplace |
| `apps/web/vitest.setup.ts` | C (T13) | stub de `ResizeObserver` para o Recharts no jsdom |
| `apps/web/test/metrics-fixtures.ts` | C (T12) | respostas de exemplo dos 6 painéis para os testes da web |
| `apps/web/src/components/metrics/*.tsx` | C (T12–T14) | barra de filtros, KPIs, estado por seção, seções e gráficos |
| `apps/web/src/app/(app)/dashboard/page.tsx` | C (T14) | troca o placeholder pelo dashboard |
| `apps/web/src/app/globals.css` | C (T14) | paleta clara (`html:not(.dark)`) |
| `apps/web/e2e/seed.ts`, `apps/web/e2e/dashboard.spec.ts` | C (T15) | dados de métricas no seed + E2E |

---

### Task 1: Contrato compartilhado de métricas (Trilha B, agente Programador)

**Files:**
- Create: `packages/shared/src/metrics.ts`
- Modify: `packages/shared/src/index.ts` (acrescentar export no fim)
- Test: `packages/shared/test/metrics.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (exportado por `@afilados/shared`; usado por T4, T6–T15):
  - `METRICS_TIMEZONE = 'America/Sao_Paulo'`, `METRICS_MAX_RANGE_DAYS = 366`
  - `METRICS_PERIODS = ['today','7d','30d','90d','custom'] as const`, `type MetricsPeriod`
  - `metricsQuerySchema` (zod; entrada `{from: string ISO, to: string ISO, groupJid?: string}`, saída `MetricsQuery`)
  - `interface MetricsQuery { from: Date; to: Date; groupJid?: string }` (`from` inclusivo, `to` exclusivo)
  - `spDayKey(d: Date): string` (`'YYYY-MM-DD'` no fuso SP), `spMidnight(dayKey: string): Date`, `spAddDays(dayKey: string, n: number): string`, `spDayKeysInRange(from: Date, to: Date): string[]`
  - `previousRange(from: Date, to: Date): { from: Date; to: Date }`
  - `periodRange(period: Exclude<MetricsPeriod,'custom'>, now: Date): { from: Date; to: Date }`, `customRange(fromDay: string, toDay: string): { from: Date; to: Date }` (`toDay` inclusivo)
  - `metricsDelta(current: number, previous: number): MetricsDelta`
  - Tipos de resposta: `MetricsDelta`, `MetricsOverview`, `MetricsGroups`, `MetricsGroupsDay`, `MetricsGroupRow`, `MetricsSends`, `MetricsProducts`, `MetricsClicks`, `MetricsAutomation`, `MetricsGroupOption`

- [ ] **Step 1: Write the failing test**

Crie `packages/shared/test/metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  customRange,
  metricsDelta,
  metricsQuerySchema,
  periodRange,
  previousRange,
  spAddDays,
  spDayKey,
  spDayKeysInRange,
  spMidnight,
} from '../src/metrics';

describe('metricsQuerySchema', () => {
  it('aceita from/to ISO e groupJid opcional', () => {
    const q = metricsQuerySchema.parse({
      from: '2026-10-01T03:00:00.000Z',
      to: '2026-10-31T03:00:00.000Z',
    });
    expect(q.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(q.to.toISOString()).toBe('2026-10-31T03:00:00.000Z');
    expect(q.groupJid).toBeUndefined();
    const g = metricsQuerySchema.parse({
      from: '2026-10-01T00:00:00-03:00',
      to: '2026-10-02T00:00:00-03:00',
      groupJid: '123@g.us',
    });
    expect(g.groupJid).toBe('123@g.us');
    expect(g.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('exige from e to', () => {
    expect(() => metricsQuerySchema.parse({ to: '2026-10-02T00:00:00Z' })).toThrow();
    expect(() => metricsQuerySchema.parse({ from: '2026-10-02T00:00:00Z' })).toThrow();
  });

  it('rejeita datas inválidas', () => {
    expect(() => metricsQuerySchema.parse({ from: 'ontem', to: '2026-10-02T00:00:00Z' })).toThrow();
  });

  it('rejeita to <= from', () => {
    expect(() =>
      metricsQuerySchema.parse({ from: '2026-10-02T00:00:00Z', to: '2026-10-02T00:00:00Z' }),
    ).toThrow(/posterior/);
  });

  it('aceita 366 dias e rejeita mais', () => {
    expect(() =>
      metricsQuerySchema.parse({ from: '2025-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }),
    ).not.toThrow();
    expect(() =>
      metricsQuerySchema.parse({ from: '2025-01-01T00:00:00Z', to: '2026-01-02T00:00:00.001Z' }),
    ).toThrow(/366/);
  });
});

describe('helpers de fuso America/Sao_Paulo', () => {
  it('spDayKey usa o dia local de SP', () => {
    expect(spDayKey(new Date('2026-01-01T02:00:00Z'))).toBe('2025-12-31');
    expect(spDayKey(new Date('2026-01-01T03:00:00Z'))).toBe('2026-01-01');
  });

  it('spMidnight devolve a meia-noite de SP em UTC', () => {
    expect(spMidnight('2026-10-13').toISOString()).toBe('2026-10-13T03:00:00.000Z');
  });

  it('spAddDays atravessa mês e ano', () => {
    expect(spAddDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(spAddDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('spDayKeysInRange lista os dias com to exclusivo', () => {
    expect(spDayKeysInRange(spMidnight('2025-12-30'), spMidnight('2026-01-02'))).toEqual([
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
    ]);
  });

  it('periodRange termina na meia-noite de amanhã (SP)', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    const r = periodRange('7d', now);
    expect(r.from.toISOString()).toBe('2026-10-07T03:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    const today = periodRange('today', new Date('2026-10-14T01:00:00Z'));
    expect(today.from.toISOString()).toBe('2026-10-13T03:00:00.000Z');
    expect(today.to.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    const r30 = periodRange('30d', now);
    expect(spDayKeysInRange(r30.from, r30.to)).toHaveLength(30);
    const r90 = periodRange('90d', now);
    expect(spDayKeysInRange(r90.from, r90.to)).toHaveLength(90);
  });

  it('customRange inclui o último dia', () => {
    const r = customRange('2026-02-01', '2026-02-28');
    expect(r.from.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-03-01T03:00:00.000Z');
  });

  it('previousRange é o período imediatamente anterior de mesmo tamanho', () => {
    const r = previousRange(spMidnight('2026-10-08'), spMidnight('2026-10-15'));
    expect(r.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-08T03:00:00.000Z');
  });
});

describe('metricsDelta', () => {
  it('calcula variação percentual com 1 casa', () => {
    expect(metricsDelta(110, 100)).toEqual({ current: 110, previous: 100, changePct: 10 });
    expect(metricsDelta(2, 3)).toEqual({ current: 2, previous: 3, changePct: -33.3 });
  });
  it('changePct é null quando o anterior é zero', () => {
    expect(metricsDelta(5, 0).changePct).toBeNull();
    expect(metricsDelta(0, 0).changePct).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/shared exec vitest run test/metrics.test.ts`
Expected: FAIL com `Failed to resolve import "../src/metrics"`.

- [ ] **Step 3: Write minimal implementation**

Crie `packages/shared/src/metrics.ts`:

```ts
import { z } from 'zod';

export const METRICS_TIMEZONE = 'America/Sao_Paulo';
export const METRICS_MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

export const METRICS_PERIODS = ['today', '7d', '30d', '90d', 'custom'] as const;
export type MetricsPeriod = (typeof METRICS_PERIODS)[number];

/** `from` inclusivo, `to` exclusivo. */
export interface MetricsQuery {
  from: Date;
  to: Date;
  groupJid?: string;
}

export const metricsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    groupJid: z.string().trim().min(1).max(128).optional(),
  })
  .transform((v): MetricsQuery => {
    const q: MetricsQuery = { from: new Date(v.from), to: new Date(v.to) };
    if (v.groupJid) q.groupJid = v.groupJid;
    return q;
  })
  .refine((q) => q.to.getTime() > q.from.getTime(), {
    message: 'to deve ser posterior a from',
    path: ['to'],
  })
  .refine((q) => q.to.getTime() - q.from.getTime() <= METRICS_MAX_RANGE_DAYS * DAY_MS, {
    message: `intervalo máximo de ${METRICS_MAX_RANGE_DAYS} dias`,
    path: ['to'],
  });

// ---------- Datas no fuso de São Paulo ----------

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: METRICS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: METRICS_TIMEZONE,
  timeZoneName: 'longOffset',
});

/** Deslocamento de SP em minutos naquele instante (ex.: -180). */
function spOffsetMinutes(at: Date): number {
  const name = offsetFormatter.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function parseDayKey(dayKey: string): [number, number, number] {
  const [y, m, d] = dayKey.split('-').map(Number);
  return [y!, m!, d!];
}

/** Dia local de SP no formato `YYYY-MM-DD`. */
export function spDayKey(d: Date): string {
  return dayFormatter.format(d);
}

/** Instante UTC da meia-noite de SP do dia informado. */
export function spMidnight(dayKey: string): Date {
  const [y, m, d] = parseDayKey(dayKey);
  const offset = spOffsetMinutes(new Date(Date.UTC(y, m - 1, d, 12)));
  return new Date(Date.UTC(y, m - 1, d) - offset * 60_000);
}

export function spAddDays(dayKey: string, n: number): string {
  const [y, m, d] = parseDayKey(dayKey);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Dias locais de SP cobertos por [from, to). */
export function spDayKeysInRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  const last = spDayKey(new Date(to.getTime() - 1));
  for (let k = spDayKey(from); k <= last; k = spAddDays(k, 1)) out.push(k);
  return out;
}

export function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const len = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - len), to: new Date(from.getTime()) };
}

const PERIOD_DAYS: Record<Exclude<MetricsPeriod, 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Últimos N dias de SP, incluindo hoje: [meia-noite de N-1 dias atrás, meia-noite de amanhã). */
export function periodRange(
  period: Exclude<MetricsPeriod, 'custom'>,
  now: Date,
): { from: Date; to: Date } {
  const today = spDayKey(now);
  return {
    from: spMidnight(spAddDays(today, -(PERIOD_DAYS[period] - 1))),
    to: spMidnight(spAddDays(today, 1)),
  };
}

/** Intervalo personalizado com `toDay` inclusivo. */
export function customRange(fromDay: string, toDay: string): { from: Date; to: Date } {
  return { from: spMidnight(fromDay), to: spMidnight(spAddDays(toDay, 1)) };
}

// ---------- Respostas da API ----------

export interface MetricsDelta {
  current: number;
  previous: number;
  /** variação percentual com 1 casa; null quando `previous` é 0 */
  changePct: number | null;
}

export function metricsDelta(current: number, previous: number): MetricsDelta {
  const changePct =
    previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
  return { current, previous, changePct };
}

export interface MetricsGroupOption {
  jid: string;
  name: string;
}

export interface MetricsOverview {
  range: { from: string; to: string; previousFrom: string; previousTo: string };
  /** ISO do primeiro evento/snapshot de grupo do tenant; null se a coleta ainda não começou */
  trackingSince: string | null;
  /** todos os grupos monitorados (bot admin) do tenant, para o seletor de grupo */
  groupOptions: MetricsGroupOption[];
  kpis: {
    /** current = membros agora; previous = membros no início do período (agora − saldo do período) */
    members: MetricsDelta;
    joins: MetricsDelta;
    leaves: MetricsDelta;
    net: MetricsDelta;
    sends: MetricsDelta;
    /** percentual 0–100 */
    successRate: MetricsDelta;
    clicks: MetricsDelta;
  };
}

export interface MetricsGroupsDay {
  date: string;
  joins: number;
  leaves: number;
  net: number;
  /** saldo acumulado desde o início do período */
  cumulativeNet: number;
  /** soma dos snapshots do dia; null quando não há snapshot */
  members: number | null;
}

export interface MetricsGroupRow {
  jid: string;
  name: string;
  members: number;
  joins: number;
  leaves: number;
  net: number;
  /** saldo / membros no início do período × 100; null quando o início é 0 */
  growthPct: number | null;
}

export interface MetricsGroups {
  trackingSince: string | null;
  totals: { members: number; joins: number; leaves: number; net: number };
  series: MetricsGroupsDay[];
  /** ordenado por saldo desc, depois nome */
  groups: MetricsGroupRow[];
}

export interface MetricsSends {
  /** successRate em percentual 0–100 (0 quando total = 0) */
  totals: { total: number; sent: number; failed: number; successRate: number };
  daily: { date: string; sent: number; failed: number }[];
  /** 24 posições, hora local 0–23 */
  hourly: { hour: number; sent: number; failed: number }[];
  /** 168 células; weekday 0 = domingo … 6 = sábado */
  heatmap: { weekday: number; hour: number; count: number }[];
  /** até 5, mais frequentes primeiro */
  topErrors: { error: string; count: number }[];
}

export interface MetricsProducts {
  /** até 10, mais enviados primeiro */
  top: { productId: string; title: string; source: string; image: string | null; sends: number }[];
  byMarketplace: { source: string; sends: number }[];
}

export interface MetricsClicks {
  total: number;
  daily: { date: string; clicks: number }[];
  byLink: { groupLinkId: string; slug: string; label: string; clicks: number }[];
}

export interface MetricsAutomation {
  mirror: { captured: number; mirrored: number; discarded: number; errors: number };
  automation: { discovered: number; dispatched: number; skipped: number; errors: number };
  coupons: { validated: number; propagated: number };
  daily: { date: string; mirrored: number; dispatched: number }[];
}
```

Em `packages/shared/src/index.ts`, acrescente ao fim:

```ts
export * from './metrics';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @afilados/shared exec vitest run test/metrics.test.ts && pnpm --filter @afilados/shared typecheck`
Expected: PASS (14 testes) e typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/metrics.ts packages/shared/src/index.ts packages/shared/test/metrics.test.ts
git commit -m "feat(shared): contrato de métricas (query, tipos e fuso SP)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema Prisma e migration dos eventos de métricas (Trilha A, agente Prisma)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (relações em `Tenant`, ~linha 40, e `GroupLink`, ~linha 735; bloco novo no fim)
- Create: `packages/db/prisma/migrations/20261013120000_metrics_events/migration.sql`
- Modify: `packages/db/src/index.ts` (`TENANT_MODELS`)
- Test: `packages/db/test/metrics-schema.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (Prisma Client, usado por T3–T10):
  - `enum GroupMemberAction { JOIN LEAVE REMOVED ADDED PROMOTED DEMOTED }`
  - `prisma.groupMemberEvent`: `{ id, tenantId, sessionId, groupJid, participantJid, action, actorJid: string|null, occurredAt: Date, dedupeKey: string (@unique), createdAt }`
  - `prisma.groupSnapshot`: `{ id, tenantId, sessionId, groupJid, date: Date, memberCount: number, createdAt }`, chave única composta `sessionId_groupJid_date`
  - `prisma.linkClickEvent`: `{ id, tenantId, groupLinkId, slug, targetGroupJid: string|null, clickedAt }`
  - `forTenant()` passa a escopar os três modelos.

- [ ] **Step 1: Write the failing test**

Crie `packages/db/test/metrics-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant, Prisma } from '../src/index';

let a: string;
let b: string;
let sessionA: string;
let linkId: string;

beforeAll(async () => {
  a = (await prisma.tenant.create({ data: { name: 'metrics-a' } })).id;
  b = (await prisma.tenant.create({ data: { name: 'metrics-b' } })).id;
  sessionA = (await prisma.waSession.create({ data: { tenantId: a, label: 's' } })).id;
  linkId = (
    await prisma.groupLink.create({
      data: {
        tenantId: a,
        sessionId: sessionA,
        slug: `metrics-${Date.now()}`,
        label: 'L',
        baseName: 'Grupo',
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.$disconnect();
});

describe('modelos de métricas', () => {
  it('GroupMemberEvent é idempotente por dedupeKey e escopado por tenant', async () => {
    const data = {
      tenantId: a,
      sessionId: sessionA,
      groupJid: 'g1@g.us',
      participantJid: '5511999990000@s.whatsapp.net',
      action: 'JOIN' as const,
      occurredAt: new Date('2026-10-13T12:00:00Z'),
      dedupeKey: `k-${Date.now()}`,
    };
    await prisma.groupMemberEvent.create({ data });
    await expect(prisma.groupMemberEvent.create({ data })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    const skipped = await prisma.groupMemberEvent.createMany({ data: [data], skipDuplicates: true });
    expect(skipped.count).toBe(0);
    expect(await forTenant(a).groupMemberEvent.count()).toBe(1);
    expect(await forTenant(b).groupMemberEvent.count()).toBe(0);
  });

  it('GroupSnapshot é único por sessão + grupo + dia', async () => {
    const date = new Date('2026-10-13T03:00:00Z');
    await prisma.groupSnapshot.create({
      data: { tenantId: a, sessionId: sessionA, groupJid: 'g1@g.us', date, memberCount: 10 },
    });
    const up = await prisma.groupSnapshot.upsert({
      where: { sessionId_groupJid_date: { sessionId: sessionA, groupJid: 'g1@g.us', date } },
      update: { memberCount: 12 },
      create: { tenantId: a, sessionId: sessionA, groupJid: 'g1@g.us', date, memberCount: 12 },
    });
    expect(up.memberCount).toBe(12);
    expect(await prisma.groupSnapshot.count({ where: { tenantId: a } })).toBe(1);
  });

  it('LinkClickEvent cai em cascata com o GroupLink', async () => {
    await prisma.linkClickEvent.create({
      data: { tenantId: a, groupLinkId: linkId, slug: 'x', targetGroupJid: 'g1@g.us' },
    });
    expect(await forTenant(a).linkClickEvent.count()).toBe(1);
    await prisma.groupLink.delete({ where: { id: linkId } });
    expect(await prisma.linkClickEvent.count({ where: { tenantId: a } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/db exec vitest run test/metrics-schema.test.ts`
Expected: FAIL com `Cannot read properties of undefined (reading 'create')` (o client não tem `groupMemberEvent`).

- [ ] **Step 3: Write minimal implementation**

Em `packages/db/prisma/schema.prisma`, no `model Tenant`, logo após `groupLinks        GroupLink[]`:

```prisma
  groupMemberEvents GroupMemberEvent[]
  groupSnapshots    GroupSnapshot[]
  linkClickEvents   LinkClickEvent[]
```

No `model GroupLink`, logo após `groups              ManagedGroup[]`:

```prisma
  clickEvents         LinkClickEvent[]
```

No fim do arquivo:

```prisma

// ---------- Métricas (F6) ----------
enum GroupMemberAction {
  JOIN
  LEAVE
  REMOVED
  ADDED
  PROMOTED
  DEMOTED
}

model GroupMemberEvent {
  id             String            @id @default(cuid())
  tenantId       String
  tenant         Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessionId      String
  groupJid       String
  /// JID bruto; sem nome nem telefone formatado (privacidade).
  participantJid String
  action         GroupMemberAction
  actorJid       String?
  occurredAt     DateTime
  /// Idempotência: sessionId|groupJid|participantJid|action|minuto de occurredAt.
  dedupeKey      String            @unique
  createdAt      DateTime          @default(now())

  @@index([tenantId, occurredAt])
  @@index([tenantId, groupJid, occurredAt])
}

model GroupSnapshot {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessionId   String
  groupJid    String
  /// Meia-noite de America/Sao_Paulo do dia da fotografia.
  date        DateTime
  memberCount Int
  createdAt   DateTime @default(now())

  @@unique([sessionId, groupJid, date])
  @@index([tenantId, date])
  @@index([tenantId, groupJid, date])
}

model LinkClickEvent {
  id             String    @id @default(cuid())
  tenantId       String
  tenant         Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  groupLinkId    String
  groupLink      GroupLink @relation(fields: [groupLinkId], references: [id], onDelete: Cascade)
  slug           String
  targetGroupJid String?
  clickedAt      DateTime  @default(now())

  @@index([tenantId, clickedAt])
  @@index([groupLinkId, clickedAt])
}
```

Crie `packages/db/prisma/migrations/20261013120000_metrics_events/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "GroupMemberAction" AS ENUM ('JOIN', 'LEAVE', 'REMOVED', 'ADDED', 'PROMOTED', 'DEMOTED');

-- CreateTable
CREATE TABLE "GroupMemberEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "participantJid" TEXT NOT NULL,
    "action" "GroupMemberAction" NOT NULL,
    "actorJid" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMemberEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkClickEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupLinkId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "targetGroupJid" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupMemberEvent_dedupeKey_key" ON "GroupMemberEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "GroupMemberEvent_tenantId_occurredAt_idx" ON "GroupMemberEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "GroupMemberEvent_tenantId_groupJid_occurredAt_idx" ON "GroupMemberEvent"("tenantId", "groupJid", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSnapshot_sessionId_groupJid_date_key" ON "GroupSnapshot"("sessionId", "groupJid", "date");

-- CreateIndex
CREATE INDEX "GroupSnapshot_tenantId_date_idx" ON "GroupSnapshot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "GroupSnapshot_tenantId_groupJid_date_idx" ON "GroupSnapshot"("tenantId", "groupJid", "date");

-- CreateIndex
CREATE INDEX "LinkClickEvent_tenantId_clickedAt_idx" ON "LinkClickEvent"("tenantId", "clickedAt");

-- CreateIndex
CREATE INDEX "LinkClickEvent_groupLinkId_clickedAt_idx" ON "LinkClickEvent"("groupLinkId", "clickedAt");

-- AddForeignKey
ALTER TABLE "GroupMemberEvent" ADD CONSTRAINT "GroupMemberEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSnapshot" ADD CONSTRAINT "GroupSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkClickEvent" ADD CONSTRAINT "LinkClickEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkClickEvent" ADD CONSTRAINT "LinkClickEvent_groupLinkId_fkey" FOREIGN KEY ("groupLinkId") REFERENCES "GroupLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Em `packages/db/src/index.ts`, dentro de `TENANT_MODELS`, logo após `'ManagedGroup',`:

```ts
  'GroupMemberEvent',
  'GroupSnapshot',
  'LinkClickEvent',
```

- [ ] **Step 4: Run test to verify it passes**

Aplicar a migration, conferir que ela bate com o schema (exit 0 = sem diferença) e rodar o teste:

```bash
.superpowers/sdd/remote.sh setup
.superpowers/sdd/remote.sh run 'cd packages/db && pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code'
.superpowers/sdd/remote.sh run pnpm --filter @afilados/db exec vitest run test/metrics-schema.test.ts
pnpm db:generate && pnpm --filter @afilados/db typecheck
```
Expected: `setup` aplica `20261013120000_metrics_events`; `migrate diff` imprime `No difference detected.` com exit 0; 3 testes PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261013120000_metrics_events/migration.sql packages/db/src/index.ts packages/db/test/metrics-schema.test.ts
git commit -m "feat(db): GroupMemberEvent, GroupSnapshot e LinkClickEvent

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Handler de `group-participants.update` gravando `GroupMemberEvent` (Trilha A, agente Prisma)

**Files:**
- Modify: `apps/worker/src/wa/gateway.ts` (`GroupParticipantsUpdateEvent`, ~linha 51)
- Modify: `apps/worker/src/wa/baileys-gateway.ts` (handler `group-participants.update`, ~linha 230)
- Create: `apps/worker/src/metrics/group-member-recorder.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/group-member-recorder.test.ts`

**Interfaces:**
- Consumes: `prisma.groupMemberEvent`, `GroupMemberAction` (T2); `WhatsAppGateway.onGroupParticipants` (existente).
- Produces:
  - `GroupParticipantsUpdateEvent.author?: string` (JID de quem executou a ação, quando o WhatsApp informa)
  - `mapParticipantAction(action: string, participantJid: string, author?: string): GroupMemberAction | null`
  - `memberEventDedupeKey(e: { sessionId: string; groupJid: string; participantJid: string; action: GroupMemberAction; occurredAt: Date }): string`
  - `class GroupMemberRecorder { constructor(gateway: Pick<WhatsAppGateway,'onGroupParticipants'>, now?: () => Date); start(): void; record(ev: GroupParticipantsUpdateEvent): Promise<number> }` (`record` nunca lança e devolve quantas linhas gravou)

Regras de mapeamento: `add` sem `author` ou com `author` igual ao participante → `JOIN`; `add` feito por outro → `ADDED`; `remove` análogo → `LEAVE` / `REMOVED`; `promote` → `PROMOTED`; `demote` → `DEMOTED`; qualquer outra ação (ex.: `modify`) é ignorada. "Mesmo usuário" compara a parte antes de `@`, sem o sufixo de dispositivo (`:12`). Só grava se o `WaGroup` (sessionId + jid) existir com `botIsAdmin = true`. Idempotência: `dedupeKey = sessionId|groupJid|participantJid|action|minuto(occurredAt)` + `createMany({ skipDuplicates: true })`; retransmissões do socket no mesmo minuto não duplicam.

- [ ] **Step 1: Write the failing test**

Crie `apps/worker/test/group-member-recorder.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@afilados/db';
import {
  GroupMemberRecorder,
  mapParticipantAction,
  memberEventDedupeKey,
} from '../src/metrics/group-member-recorder';
import type { GroupParticipantsUpdateEvent } from '../src/wa/gateway';

const ADMIN_GROUP = 'rec-admin@g.us';
const COMMON_GROUP = 'rec-common@g.us';
const ADMIN = 'adm@s.whatsapp.net';
const NOW = new Date('2026-10-13T15:00:20Z');
let tenantId: string;
let sessionId: string;

class FakeGateway {
  handler?: (ev: GroupParticipantsUpdateEvent) => void;
  onGroupParticipants(h: (ev: GroupParticipantsUpdateEvent) => void) {
    this.handler = h;
  }
}

const makeRecorder = (now = NOW) => {
  const gateway = new FakeGateway();
  return { gateway, recorder: new GroupMemberRecorder(gateway, () => now) };
};

const ev = (
  action: GroupParticipantsUpdateEvent['action'],
  participants: string[],
  author?: string,
  jid = ADMIN_GROUP,
): GroupParticipantsUpdateEvent => ({
  sessionId,
  jid,
  participants,
  action,
  ...(author ? { author } : {}),
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'recorder' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 'chip' } })).id;
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: ADMIN_GROUP, name: 'Admin', botIsAdmin: true },
  });
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: COMMON_GROUP, name: 'Comum', botIsAdmin: false },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe('mapParticipantAction', () => {
  it.each([
    ['add', 'p@s.whatsapp.net', undefined, 'JOIN'],
    ['add', 'p@s.whatsapp.net', 'p:12@s.whatsapp.net', 'JOIN'],
    ['add', 'p@s.whatsapp.net', ADMIN, 'ADDED'],
    ['remove', 'p@s.whatsapp.net', undefined, 'LEAVE'],
    ['remove', 'p@s.whatsapp.net', 'p@s.whatsapp.net', 'LEAVE'],
    ['remove', 'p@s.whatsapp.net', ADMIN, 'REMOVED'],
    ['promote', 'p@s.whatsapp.net', ADMIN, 'PROMOTED'],
    ['demote', 'p@s.whatsapp.net', ADMIN, 'DEMOTED'],
    ['modify', 'p@s.whatsapp.net', undefined, null],
  ])('%s de %s por %s → %s', (action, participant, author, expected) => {
    expect(mapParticipantAction(action, participant, author)).toBe(expected);
  });

  it('dedupeKey agrupa por minuto', () => {
    const base = {
      sessionId: 's',
      groupJid: 'g@g.us',
      participantJid: 'p@s.whatsapp.net',
      action: 'JOIN' as const,
    };
    const a = memberEventDedupeKey({ ...base, occurredAt: new Date('2026-10-13T15:00:01Z') });
    const b = memberEventDedupeKey({ ...base, occurredAt: new Date('2026-10-13T15:00:59Z') });
    const c = memberEventDedupeKey({ ...base, occurredAt: new Date('2026-10-13T15:01:00Z') });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('GroupMemberRecorder.record', () => {
  it('grava as seis ações com actorJid e tenant corretos', async () => {
    const { recorder } = makeRecorder();
    await recorder.record(ev('add', ['six-join@s.whatsapp.net']));
    await recorder.record(ev('add', ['six-added@s.whatsapp.net'], ADMIN));
    await recorder.record(ev('remove', ['six-leave@s.whatsapp.net']));
    await recorder.record(ev('remove', ['six-removed@s.whatsapp.net'], ADMIN));
    await recorder.record(ev('promote', ['six-promoted@s.whatsapp.net'], ADMIN));
    await recorder.record(ev('demote', ['six-demoted@s.whatsapp.net'], ADMIN));
    const rows = await prisma.groupMemberEvent.findMany({
      where: { tenantId, participantJid: { startsWith: 'six-' } },
      orderBy: { participantJid: 'asc' },
    });
    expect(rows.map((r) => [r.participantJid.split('@')[0], r.action])).toEqual([
      ['six-added', 'ADDED'],
      ['six-demoted', 'DEMOTED'],
      ['six-join', 'JOIN'],
      ['six-leave', 'LEAVE'],
      ['six-promoted', 'PROMOTED'],
      ['six-removed', 'REMOVED'],
    ]);
    expect(rows.find((r) => r.action === 'ADDED')).toMatchObject({
      actorJid: ADMIN,
      groupJid: ADMIN_GROUP,
      sessionId,
      occurredAt: NOW,
    });
    expect(rows.find((r) => r.action === 'JOIN')?.actorJid).toBeNull();
  });

  it('grava um evento por participante', async () => {
    const { recorder } = makeRecorder();
    const n = await recorder.record(
      ev('add', ['multi-1@s.whatsapp.net', 'multi-2@s.whatsapp.net'], ADMIN),
    );
    expect(n).toBe(2);
  });

  it('é idempotente para retransmissões no mesmo minuto', async () => {
    const event = ev('add', ['dup@s.whatsapp.net']);
    expect(await makeRecorder().recorder.record(event)).toBe(1);
    expect(await makeRecorder().recorder.record(event)).toBe(0);
    expect(await makeRecorder(new Date('2026-10-13T15:00:50Z')).recorder.record(event)).toBe(0);
    expect(
      await prisma.groupMemberEvent.count({ where: { participantJid: 'dup@s.whatsapp.net' } }),
    ).toBe(1);
  });

  it('ignora grupo sem bot admin e grupo desconhecido', async () => {
    const { recorder } = makeRecorder();
    expect(
      await recorder.record(ev('add', ['ign-1@s.whatsapp.net'], undefined, COMMON_GROUP)),
    ).toBe(0);
    expect(await recorder.record(ev('add', ['ign-2@s.whatsapp.net'], undefined, 'nao@g.us'))).toBe(
      0,
    );
    expect(
      await prisma.groupMemberEvent.count({ where: { participantJid: { startsWith: 'ign-' } } }),
    ).toBe(0);
  });

  it('erro durante a gravação é engolido e não propaga', async () => {
    // `now` é chamado dentro do try, depois da consulta ao banco: simula uma falha no meio da gravação
    const broken = new GroupMemberRecorder(new FakeGateway(), () => {
      throw new Error('falha no meio da gravação');
    });
    await expect(broken.record(ev('add', ['err@s.whatsapp.net']))).resolves.toBe(0);
    expect(
      await prisma.groupMemberEvent.count({ where: { participantJid: 'err@s.whatsapp.net' } }),
    ).toBe(0);
  });

  it('start() registra o handler no gateway', async () => {
    const { gateway, recorder } = makeRecorder();
    recorder.start();
    gateway.handler!(ev('add', ['via-start@s.whatsapp.net']));
    await vi.waitFor(async () => {
      expect(
        await prisma.groupMemberEvent.count({ where: { participantJid: 'via-start@s.whatsapp.net' } }),
      ).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/group-member-recorder.test.ts`
Expected: FAIL com `Failed to load url ../src/metrics/group-member-recorder`.

- [ ] **Step 3: Write minimal implementation**

Em `apps/worker/src/wa/gateway.ts`, substitua a interface `GroupParticipantsUpdateEvent` por:

```ts
export interface GroupParticipantsUpdateEvent {
  sessionId: string;
  jid: string;
  participants: string[];
  action: GroupParticipantAction;
  /** JID de quem executou a ação (admin), quando o WhatsApp informa */
  author?: string;
}
```

Em `apps/worker/src/wa/baileys-gateway.ts`, no `sock.ev.on('group-participants.update', ...)`, troque a montagem do `payload` por:

```ts
        const payload: GroupParticipantsUpdateEvent = {
          sessionId,
          jid: event.id,
          participants: event.participants,
          action: event.action as GroupParticipantAction,
          ...(event.author ? { author: event.author } : {}),
        };
```

Crie `apps/worker/src/metrics/group-member-recorder.ts`:

```ts
import pino from 'pino';
import { prisma, type GroupMemberAction } from '@afilados/db';
import type { GroupParticipantsUpdateEvent, WhatsAppGateway } from '../wa/gateway';

const log = pino({ name: 'group-member-recorder' });

/** Parte do usuário do JID, sem domínio nem sufixo de dispositivo (`5511…:12@s.whatsapp.net` → `5511…`). */
function userOf(jid: string): string {
  return jid.split('@')[0]!.split(':')[0]!;
}

export function mapParticipantAction(
  action: string,
  participantJid: string,
  author?: string,
): GroupMemberAction | null {
  const byOther = !!author && userOf(author) !== userOf(participantJid);
  switch (action) {
    case 'add':
      return byOther ? 'ADDED' : 'JOIN';
    case 'remove':
      return byOther ? 'REMOVED' : 'LEAVE';
    case 'promote':
      return 'PROMOTED';
    case 'demote':
      return 'DEMOTED';
    default:
      return null;
  }
}

/** O socket pode retransmitir o mesmo evento: a chave agrupa por minuto. */
export function memberEventDedupeKey(e: {
  sessionId: string;
  groupJid: string;
  participantJid: string;
  action: GroupMemberAction;
  occurredAt: Date;
}): string {
  const minute = Math.floor(e.occurredAt.getTime() / 60_000);
  return `${e.sessionId}|${e.groupJid}|${e.participantJid}|${e.action}|${minute}`;
}

/** Grava `GroupMemberEvent` para grupos em que o bot é admin. */
export class GroupMemberRecorder {
  constructor(
    private readonly gateway: Pick<WhatsAppGateway, 'onGroupParticipants'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start() {
    this.gateway.onGroupParticipants((ev) => {
      void this.record(ev);
    });
  }

  /** Nunca lança: falha de banco é logada e engolida para não afetar o gateway Baileys. */
  async record(ev: GroupParticipantsUpdateEvent): Promise<number> {
    try {
      const group = await prisma.waGroup.findUnique({
        where: { sessionId_jid: { sessionId: ev.sessionId, jid: ev.jid } },
        select: { tenantId: true, botIsAdmin: true },
      });
      if (!group?.botIsAdmin) return 0;
      const occurredAt = this.now();
      const rows = ev.participants.flatMap((participantJid) => {
        const action = mapParticipantAction(ev.action, participantJid, ev.author);
        if (!action) return [];
        return [
          {
            tenantId: group.tenantId,
            sessionId: ev.sessionId,
            groupJid: ev.jid,
            participantJid,
            action,
            actorJid: ev.author ?? null,
            occurredAt,
            dedupeKey: memberEventDedupeKey({
              sessionId: ev.sessionId,
              groupJid: ev.jid,
              participantJid,
              action,
              occurredAt,
            }),
          },
        ];
      });
      if (rows.length === 0) return 0;
      const res = await prisma.groupMemberEvent.createMany({ data: rows, skipDuplicates: true });
      return res.count;
    } catch (err) {
      log.error({ err, sessionId: ev.sessionId, jid: ev.jid }, 'falha ao gravar GroupMemberEvent');
      return 0;
    }
  }
}
```

Em `apps/worker/src/main.ts`:
1. Acrescente o import, junto dos outros imports locais:
   ```ts
   import { GroupMemberRecorder } from './metrics/group-member-recorder';
   ```
2. Logo após `const groupLinkMonitor = new GroupLinkMonitor(gateway);`:
   ```ts
   const groupMemberRecorder = new GroupMemberRecorder(gateway);
   ```
3. Logo antes de `await manager.start();` (o handler precisa estar registrado antes das sessões conectarem):
   ```ts
   groupMemberRecorder.start();
   ```

- [ ] **Step 4: Run test to verify it passes**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/group-member-recorder.test.ts test/baileys-gateway.test.ts test/group-link-monitor.test.ts
pnpm --filter @afilados/worker typecheck
```
Expected: os três arquivos PASS (o recorder com 16 testes; os dois existentes sem regressão) e typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/wa/gateway.ts apps/worker/src/wa/baileys-gateway.ts apps/worker/src/metrics/group-member-recorder.ts apps/worker/src/main.ts apps/worker/test/group-member-recorder.test.ts
git commit -m "feat(worker): grava entradas e saídas de grupos (GroupMemberEvent)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Snapshots diários, job BullMQ e retenção de 12 meses (Trilha A, agente Prisma)

**Files:**
- Modify: `packages/shared/src/queues.ts`
- Modify: `apps/worker/src/config.ts`
- Create: `apps/worker/src/metrics/group-snapshots.ts`
- Create: `apps/worker/src/processors/metrics-daily.ts`
- Modify: `apps/worker/src/wa/session-manager.ts` (fim de `syncGroups`, após o `publishEvent` de `wa.groups.synced`)
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/test/metrics-daily.test.ts`

**Interfaces:**
- Consumes: `prisma.groupSnapshot`, `prisma.groupMemberEvent`, `prisma.linkClickEvent` (T2); `spDayKey`, `spMidnight`, `METRICS_TIMEZONE` (T1).
- Produces:
  - `QUEUE_METRICS_DAILY = 'metrics-daily'`, `interface MetricsDailyJob { trigger: 'schedule' | 'manual' }` em `@afilados/shared`
  - `config.METRICS_RETENTION_DAYS: number` (env `METRICS_RETENTION_DAYS`, padrão 365, mínimo 30)
  - `snapshotGroups(where?: { sessionId?: string }, now?: Date): Promise<number>` (upsert de um `GroupSnapshot` por `WaGroup` admin, `date = spMidnight(spDayKey(now))`)
  - `purgeOldMetrics(now?: Date, retentionDays?: number): Promise<{ events: number; snapshots: number; clicks: number }>`
  - `createMetricsDailyProcessor(deps: { retentionDays: number; now?: () => Date }): (job: Job<MetricsDailyJob>) => Promise<{ snapshots: number; events: number; clicks: number }>`
  - `interface JobSchedulerLike` e `scheduleMetricsDaily(queue: JobSchedulerLike): Promise<void>` (agenda `metrics-daily` com `{ pattern: '0 0 * * *', tz: 'America/Sao_Paulo' }`)

- [ ] **Step 1: Write the failing test**

Crie `apps/worker/test/metrics-daily.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Job } from 'bullmq';
import { prisma } from '@afilados/db';
import { spDayKey, spMidnight, type MetricsDailyJob } from '@afilados/shared';
import { purgeOldMetrics, snapshotGroups } from '../src/metrics/group-snapshots';
import { createMetricsDailyProcessor, scheduleMetricsDaily } from '../src/processors/metrics-daily';
import { WaSessionManager } from '../src/wa/session-manager';
import type { BaileysGateway } from '../src/wa/baileys-gateway';
import type { GroupInfo } from '../src/wa/gateway';
import { closeRedis } from '../src/lib/redis';

const ADMIN_GROUP = 'snap-admin@g.us';
const COMMON_GROUP = 'snap-common@g.us';
const NOW = new Date('2026-10-14T01:00:00Z'); // 13/10 às 22h em SP
const DAY = new Date('2026-10-13T03:00:00Z');
const DAY_MS = 86_400_000;
let tenantId: string;
let sessionId: string;
let groupLinkId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'snapshots' } })).id;
  sessionId = (await prisma.waSession.create({ data: { tenantId, label: 'chip' } })).id;
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: ADMIN_GROUP, name: 'A', botIsAdmin: true, memberCount: 40 },
  });
  await prisma.waGroup.create({
    data: { tenantId, sessionId, jid: COMMON_GROUP, name: 'C', botIsAdmin: false, memberCount: 9 },
  });
  groupLinkId = (
    await prisma.groupLink.create({
      data: { tenantId, sessionId, slug: `snap-${Date.now()}`, label: 'L', baseName: 'G' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await closeRedis();
});

describe('snapshotGroups', () => {
  it('grava um snapshot por grupo com bot admin, no dia de SP', async () => {
    expect(await snapshotGroups({ sessionId }, NOW)).toBe(1);
    const rows = await prisma.groupSnapshot.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ groupJid: ADMIN_GROUP, memberCount: 40, date: DAY });
  });

  it('repetir no mesmo dia atualiza sem duplicar', async () => {
    await prisma.waGroup.updateMany({
      where: { sessionId, jid: ADMIN_GROUP },
      data: { memberCount: 45 },
    });
    await snapshotGroups({ sessionId }, new Date('2026-10-13T20:00:00Z'));
    const rows = await prisma.groupSnapshot.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.memberCount).toBe(45);
  });
});

describe('purgeOldMetrics', () => {
  it('apaga só o que passou da retenção', async () => {
    const old = new Date(NOW.getTime() - 400 * DAY_MS);
    const recent = new Date(NOW.getTime() - 10 * DAY_MS);
    const event = (occurredAt: Date, key: string) => ({
      tenantId,
      sessionId,
      groupJid: ADMIN_GROUP,
      participantJid: 'p@s.whatsapp.net',
      action: 'JOIN' as const,
      occurredAt,
      dedupeKey: `purge-${key}-${Date.now()}`,
    });
    await prisma.groupMemberEvent.createMany({ data: [event(old, 'old'), event(recent, 'new')] });
    await prisma.groupSnapshot.create({
      data: { tenantId, sessionId, groupJid: ADMIN_GROUP, date: old, memberCount: 1 },
    });
    await prisma.linkClickEvent.createMany({
      data: [
        { tenantId, groupLinkId, slug: 's', clickedAt: old },
        { tenantId, groupLinkId, slug: 's', clickedAt: recent },
      ],
    });

    const res = await purgeOldMetrics(NOW, 365);
    expect(res.events).toBeGreaterThanOrEqual(1);
    expect(res.snapshots).toBeGreaterThanOrEqual(1);
    expect(res.clicks).toBeGreaterThanOrEqual(1);
    expect(await prisma.groupMemberEvent.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.groupSnapshot.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.linkClickEvent.count({ where: { tenantId } })).toBe(1);
  });
});

describe('job diário', () => {
  it('processor tira snapshot e aplica retenção', async () => {
    const proc = createMetricsDailyProcessor({ retentionDays: 365, now: () => NOW });
    const out = await proc({ data: { trigger: 'manual' } } as Job<MetricsDailyJob>);
    expect(out.snapshots).toBeGreaterThanOrEqual(1);
    expect(await prisma.groupSnapshot.count({ where: { tenantId, date: DAY } })).toBe(1);
  });

  it('agenda à meia-noite de America/Sao_Paulo', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    await scheduleMetricsDaily({ upsertJobScheduler });
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'metrics-daily',
      { pattern: '0 0 * * *', tz: 'America/Sao_Paulo' },
      { name: 'daily', data: { trigger: 'schedule' } },
    );
  });
});

describe('syncGroups', () => {
  it('grava snapshot dos grupos sincronizados', async () => {
    class FakeGateway {
      async fetchGroups(): Promise<GroupInfo[]> {
        return [
          { jid: ADMIN_GROUP, name: 'A', kind: 'GROUP', botIsAdmin: true, memberCount: 50 },
          { jid: COMMON_GROUP, name: 'C', kind: 'GROUP', botIsAdmin: false, memberCount: 9 },
        ];
      }
    }
    const manager = new WaSessionManager(new FakeGateway() as unknown as BaileysGateway);
    await manager.syncGroups(sessionId, tenantId);
    const today = spMidnight(spDayKey(new Date()));
    const snap = await prisma.groupSnapshot.findFirst({
      where: { tenantId, groupJid: ADMIN_GROUP, date: today },
    });
    expect(snap?.memberCount).toBe(50);
    expect(await prisma.groupSnapshot.count({ where: { tenantId, groupJid: COMMON_GROUP } })).toBe(
      0,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/metrics-daily.test.ts`
Expected: FAIL com `Failed to load url ../src/metrics/group-snapshots`.

- [ ] **Step 3: Write minimal implementation**

Em `packages/shared/src/queues.ts`, logo após `export const QUEUE_ML_LINKS_PREWARM = 'ml-links-prewarm';`:

```ts
export const QUEUE_METRICS_DAILY = 'metrics-daily';
```

E no fim do arquivo:

```ts
export interface MetricsDailyJob {
  trigger: 'schedule' | 'manual';
}
```

Em `apps/worker/src/config.ts`, dentro do `z.object({...})`, logo após `ML_CLIENT_SECRET: z.string().optional(),`:

```ts
  // Retenção de GroupMemberEvent, GroupSnapshot e LinkClickEvent (12 meses por padrão).
  METRICS_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
```

Crie `apps/worker/src/metrics/group-snapshots.ts`:

```ts
import { prisma } from '@afilados/db';
import { spDayKey, spMidnight } from '@afilados/shared';

const DAY_MS = 86_400_000;

/** Fotografa `memberCount` de cada grupo com bot admin; um registro por sessão + grupo + dia de SP. */
export async function snapshotGroups(
  where: { sessionId?: string } = {},
  now: Date = new Date(),
): Promise<number> {
  const date = spMidnight(spDayKey(now));
  const groups = await prisma.waGroup.findMany({
    where: { botIsAdmin: true, ...(where.sessionId ? { sessionId: where.sessionId } : {}) },
    select: { tenantId: true, sessionId: true, jid: true, memberCount: true },
  });
  for (const g of groups) {
    await prisma.groupSnapshot.upsert({
      where: { sessionId_groupJid_date: { sessionId: g.sessionId, groupJid: g.jid, date } },
      update: { memberCount: g.memberCount },
      create: {
        tenantId: g.tenantId,
        sessionId: g.sessionId,
        groupJid: g.jid,
        date,
        memberCount: g.memberCount,
      },
    });
  }
  return groups.length;
}

export async function purgeOldMetrics(
  now: Date = new Date(),
  retentionDays = 365,
): Promise<{ events: number; snapshots: number; clicks: number }> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const [events, snapshots, clicks] = await prisma.$transaction([
    prisma.groupMemberEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.groupSnapshot.deleteMany({ where: { date: { lt: cutoff } } }),
    prisma.linkClickEvent.deleteMany({ where: { clickedAt: { lt: cutoff } } }),
  ]);
  return { events: events.count, snapshots: snapshots.count, clicks: clicks.count };
}
```

Crie `apps/worker/src/processors/metrics-daily.ts`:

```ts
import type { Job } from 'bullmq';
import pino from 'pino';
import { METRICS_TIMEZONE, type MetricsDailyJob } from '@afilados/shared';
import { purgeOldMetrics, snapshotGroups } from '../metrics/group-snapshots';

const log = pino({ name: 'metrics-daily' });

export interface JobSchedulerLike {
  upsertJobScheduler(
    id: string,
    repeat: { pattern: string; tz: string },
    template: { name: string; data: MetricsDailyJob },
  ): Promise<unknown>;
}

export function createMetricsDailyProcessor(deps: { retentionDays: number; now?: () => Date }) {
  return async (_job: Job<MetricsDailyJob>) => {
    const now = deps.now?.() ?? new Date();
    const snapshots = await snapshotGroups({}, now);
    const purged = await purgeOldMetrics(now, deps.retentionDays);
    log.info({ snapshots, ...purged }, 'métricas diárias concluídas');
    return { snapshots, ...purged };
  };
}

/** Idempotente: o BullMQ mantém um único agendamento com este id. */
export async function scheduleMetricsDaily(queue: JobSchedulerLike): Promise<void> {
  await queue.upsertJobScheduler(
    'metrics-daily',
    { pattern: '0 0 * * *', tz: METRICS_TIMEZONE },
    { name: 'daily', data: { trigger: 'schedule' } },
  );
}
```

Em `apps/worker/src/wa/session-manager.ts`:
1. Acrescente o import:
   ```ts
   import { snapshotGroups } from '../metrics/group-snapshots';
   ```
2. Em `syncGroups`, logo após `await publishEvent(tenantId, { type: 'wa.groups.synced', sessionId, count: groups.length });`:
   ```ts
    try {
      await snapshotGroups({ sessionId });
    } catch (err) {
      log.error({ err, sessionId }, 'falha ao gravar snapshot de grupos em syncGroups');
    }
   ```

Em `apps/worker/src/main.ts`:
1. No import de `@afilados/shared`, acrescente `QUEUE_METRICS_DAILY,` (junto das constantes) e `type MetricsDailyJob,` (junto dos tipos).
2. Troque `import { getRedis, closeRedis } from './lib/redis';` por:
   ```ts
   import { getRedis, closeRedis, getQueue } from './lib/redis';
   ```
3. Acrescente:
   ```ts
   import { createMetricsDailyProcessor, scheduleMetricsDaily } from './processors/metrics-daily';
   ```
4. Logo após a criação de `mlLinksPrewarmWorker`:
   ```ts
   // Snapshot diário dos grupos + retenção das métricas (meia-noite de SP).
   const metricsDailyWorker = new Worker<MetricsDailyJob>(
     QUEUE_METRICS_DAILY,
     createMetricsDailyProcessor({ retentionDays: config.METRICS_RETENTION_DAYS }),
     { connection: getRedis(), concurrency: 1 },
   );
   ```
5. Acrescente `metricsDailyWorker,` ao array do `for (const w of [...])` que registra `failed`, e `metricsDailyWorker.close(),` ao `Promise.all` do `shutdown()`.
6. Logo após `couponSyncScheduler.start();`:
   ```ts
   await scheduleMetricsDaily(getQueue<MetricsDailyJob>(QUEUE_METRICS_DAILY)).catch((e) =>
     log.error(e, 'falha ao agendar métricas diárias'),
   );
   ```

- [ ] **Step 4: Run test to verify it passes**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/worker exec vitest run test/metrics-daily.test.ts test/session-manager.test.ts
pnpm --filter @afilados/worker typecheck && pnpm --filter @afilados/shared typecheck
```
Expected: `metrics-daily.test.ts` com 6 testes PASS, `session-manager.test.ts` sem regressão, typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/queues.ts apps/worker/src/config.ts apps/worker/src/metrics/group-snapshots.ts apps/worker/src/processors/metrics-daily.ts apps/worker/src/wa/session-manager.ts apps/worker/src/main.ts apps/worker/test/metrics-daily.test.ts
git commit -m "feat(worker): snapshot diário de grupos, job BullMQ e retenção das métricas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `LinkClickEvent` na resolução de `/g/[slug]` (Trilha A, agente Prisma)

O `/g/[slug]` do Next (`apps/web/src/app/g/[slug]/route.ts`) só redireciona para o que `GET /api/v1/public/group-links/:slug` devolve; o clique é gravado nessa rota da api, a única consumidora desse endpoint. Hoje `GroupLink.clickCount` nunca é incrementado; a partir desta tarefa passa a ser, na mesma transação do evento. A resposta pode vir do cache Redis (30 s), então os dados do clique vão junto no cache e são removidos antes de responder.

**Files:**
- Create: `apps/api/src/lib/link-clicks.ts`
- Modify: `apps/api/src/routes/public-group-links.ts` (handler `GET /public/group-links/:slug`)
- Test: `apps/api/test/link-clicks.test.ts`

**Interfaces:**
- Consumes: `prisma.linkClickEvent` (T2).
- Produces:
  - `interface LinkClickInput { tenantId: string; groupLinkId: string; slug: string; targetGroupJid: string | null }`
  - `recordLinkClick(input: LinkClickInput, log?: Pick<FastifyBaseLogger, 'error'>): Promise<boolean>` (nunca lança; `false` em erro)
  - A resposta pública continua `{ ok, inviteLink, fallbackUrl, status }` (sem campos novos).

- [ ] **Step 1: Write the failing test**

Crie `apps/api/test/link-clicks.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { buildApp } from '../src/app';
import { getRedis } from '../src/lib/redis';
import { recordLinkClick } from '../src/lib/link-clicks';
import { createTenantWithUser, cleanupTenant } from './helpers';

const app = await buildApp({ logger: false });
const slug = `clk-${Date.now()}`;
const fbSlug = `clkfb-${Date.now()}`;
let t: Awaited<ReturnType<typeof createTenantWithUser>>;
let linkId: string;
let fallbackLinkId: string;

beforeAll(async () => {
  t = await createTenantWithUser('clicks');
  const session = await prisma.waSession.create({
    data: { tenantId: t.tenantId, label: 's', status: 'CONNECTED' },
  });
  const link = await prisma.groupLink.create({
    data: { tenantId: t.tenantId, sessionId: session.id, slug, label: 'L', baseName: 'Grupo' },
  });
  linkId = link.id;
  await prisma.managedGroup.create({
    data: {
      tenantId: t.tenantId,
      groupLinkId: link.id,
      sequence: 1,
      number: 1,
      jid: 'clk-active@g.us',
      name: 'Grupo #1',
      inviteLink: 'https://chat.whatsapp.com/CLKTEST',
      status: 'ACTIVE',
    },
  });
  fallbackLinkId = (
    await prisma.groupLink.create({
      data: {
        tenantId: t.tenantId,
        sessionId: session.id,
        slug: fbSlug,
        label: 'F',
        baseName: 'F',
        enabled: false,
        fallbackUrl: 'https://example.com/fallback',
      },
    })
  ).id;
  await getRedis().del(`grouplink:slug:${slug}`, `grouplink:slug:${fbSlug}`);
});

afterAll(async () => {
  await getRedis().del(`grouplink:slug:${slug}`, `grouplink:slug:${fbSlug}`);
  await cleanupTenant(t.tenantId);
  await app.close();
});

describe('cliques em links de grupo', () => {
  it('grava LinkClickEvent e incrementa clickCount, inclusive com resposta do cache', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/public/group-links/${slug}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ ok: true, inviteLink: 'https://chat.whatsapp.com/CLKTEST' });
      expect(body).not.toHaveProperty('click');
    }
    const events = await prisma.linkClickEvent.findMany({ where: { groupLinkId: linkId } });
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e).toMatchObject({ tenantId: t.tenantId, slug, targetGroupJid: 'clk-active@g.us' });
    }
    const link = await prisma.groupLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.clickCount).toBe(2);
  });

  it('registra o clique no fallback com targetGroupJid nulo', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/group-links/${fbSlug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fallbackUrl: 'https://example.com/fallback' });
    const events = await prisma.linkClickEvent.findMany({ where: { groupLinkId: fallbackLinkId } });
    expect(events).toHaveLength(1);
    expect(events[0]!.targetGroupJid).toBeNull();
  });

  it('slug inexistente não grava nada', async () => {
    const before = await prisma.linkClickEvent.count({ where: { tenantId: t.tenantId } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/public/group-links/nao-existe-clk' });
    expect(res.statusCode).toBe(404);
    expect(await prisma.linkClickEvent.count({ where: { tenantId: t.tenantId } })).toBe(before);
  });

  it('recordLinkClick não lança quando o link não existe', async () => {
    await expect(
      recordLinkClick({
        tenantId: t.tenantId,
        groupLinkId: 'nao-existe',
        slug: 'x',
        targetGroupJid: null,
      }),
    ).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/link-clicks.test.ts`
Expected: FAIL com `Failed to load url ../src/lib/link-clicks`.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/api/src/lib/link-clicks.ts`:

```ts
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '@afilados/db';

export interface LinkClickInput {
  tenantId: string;
  groupLinkId: string;
  slug: string;
  targetGroupJid: string | null;
}

/** Grava o clique e incrementa o contador acumulado. Nunca lança: o redirecionamento não pode falhar por isso. */
export async function recordLinkClick(
  input: LinkClickInput,
  log?: Pick<FastifyBaseLogger, 'error'>,
): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.linkClickEvent.create({ data: input }),
      prisma.groupLink.update({
        where: { id: input.groupLinkId },
        data: { clickCount: { increment: 1 } },
      }),
    ]);
    return true;
  } catch (err) {
    log?.error({ err, groupLinkId: input.groupLinkId }, 'falha ao registrar clique no link de grupo');
    return false;
  }
}
```

Em `apps/api/src/routes/public-group-links.ts`, acrescente o import:

```ts
import { recordLinkClick, type LinkClickInput } from '../lib/link-clicks';
```

Acima de `export async function publicGroupLinksRoutes`, acrescente:

```ts
interface Resolution {
  ok: true;
  inviteLink: string | null;
  fallbackUrl: string | null;
  status: string;
  /** dados do clique; ficam no cache mas nunca vão para o cliente */
  click?: LinkClickInput;
}
```

E substitua o handler `app.get('/public/group-links/:slug', ...)` inteiro por:

```ts
  app.get('/public/group-links/:slug', async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    const normalized = slug.trim().toLowerCase();
    const cacheKey = `grouplink:slug:${normalized}`;

    const respond = async (resolution: Resolution) => {
      const { click, ...body } = resolution;
      if (click) await recordLinkClick(click, req.log);
      return reply.send(body);
    };
    const cache = async (resolution: Resolution) => {
      try {
        await getRedis().set(cacheKey, JSON.stringify(resolution), 'EX', REDIRECT_CACHE_TTL_S);
      } catch {
        // ignore
      }
    };

    let cached: Resolution | null = null;
    try {
      const raw = await getRedis().get(cacheKey);
      if (raw) cached = JSON.parse(raw) as Resolution;
    } catch {
      // Falha no cache não interrompe a consulta ao banco
    }
    if (cached) return respond(cached);

    const link = await prisma.groupLink.findUnique({
      where: { slug: normalized },
      include: {
        groups: {
          where: { status: 'ACTIVE' },
          take: 1,
        },
      },
    });

    if (!link) {
      throw ApiError.notFound('Link não encontrado');
    }

    const activeGroup = link.groups[0] ?? null;
    const click: LinkClickInput = {
      tenantId: link.tenantId,
      groupLinkId: link.id,
      slug: link.slug,
      targetGroupJid: null,
    };

    if (!link.enabled || link.status !== 'ACTIVE' || !activeGroup || !activeGroup.inviteLink) {
      if (link.fallbackUrl) {
        const resolution: Resolution = {
          ok: true,
          inviteLink: null,
          fallbackUrl: link.fallbackUrl,
          status: link.status,
          click,
        };
        await cache(resolution);
        return respond(resolution);
      }

      throw new ApiError('SERVICE_UNAVAILABLE', 'Grupo temporariamente indisponível', 503);
    }

    const resolution: Resolution = {
      ok: true,
      inviteLink: activeGroup.inviteLink,
      fallbackUrl: link.fallbackUrl,
      status: link.status,
      click: { ...click, targetGroupJid: activeGroup.jid },
    };
    await cache(resolution);
    return respond(resolution);
  });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/link-clicks.test.ts test/group-links.test.ts
pnpm --filter @afilados/api typecheck
```
Expected: `link-clicks.test.ts` com 4 testes PASS, `group-links.test.ts` sem regressão, typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/link-clicks.ts apps/api/src/routes/public-group-links.ts apps/api/test/link-clicks.test.ts
git commit -m "feat(api): registra LinkClickEvent na resolução de /g/[slug]

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Base do serviço de métricas + painel de envios (Trilha B, agente Programador)

As colunas `DateTime` do Prisma são `timestamp(3)` **sem fuso**, gravadas em UTC. Por isso todo SQL de métricas: (a) compara colunas com `utc(d)` (`'…'::timestamptz AT TIME ZONE 'UTC'`), que independe do `TimeZone` da sessão, e (b) converte para hora local com `(col AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo'`. Toda consulta filtra `"tenantId"` explicitamente (o `forTenant` não alcança `$queryRaw`).

**Files:**
- Create: `apps/api/src/lib/metrics/common.ts`
- Create: `apps/api/src/lib/metrics/sends.ts`
- Create: `apps/api/test/metrics-fixtures.ts`
- Test: `apps/api/test/metrics-sends.test.ts`

**Interfaces:**
- Consumes: `MetricsQuery`, `MetricsSends`, `METRICS_TIMEZONE`, `spDayKeysInRange`, `spMidnight` (T1).
- Produces:
  - `utc(d: Date): Prisma.Sql`, `localTs(column: string): Prisma.Sql`, `localDay(column: string): Prisma.Sql`, `inRange(column: string, from: Date, to: Date): Prisma.Sql`
  - `pct(num: number, den: number): number` (percentual com 1 casa; 0 quando `den = 0`)
  - `fillDays<T extends { date: string }>(from: Date, to: Date, rows: T[], empty: (date: string) => T): T[]`
  - `assertGroupOfTenant(tenantId: string, groupJid?: string): Promise<void>` (lança `ApiError.notFound('Grupo não encontrado')`)
  - `adminGroupsOf(tenantId: string, groupJid?: string): Promise<{ jid: string; name: string; memberCount: number }[]>` (grupos com bot admin, um por jid, ordenados por nome)
  - `getSendsMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsSends>`
  - Fixtures de teste: `MetricsCtx`, `createMetricsTenant(name?)`, `addGroup(ctx, jid, opts?)`, `addSendLog(ctx, groupJid, sentAt, status?, extra?)`, `addProductSend(ctx, opts): Promise<{ productId; itemId }>`, `addCouponSend(ctx, opts)`

- [ ] **Step 1: Write the failing test**

Crie `apps/api/test/metrics-fixtures.ts`:

```ts
import { prisma, type ProductSource } from '@afilados/db';
import { createTenantWithUser } from './helpers';

export interface MetricsCtx {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
  sessionId: string;
  templateId: string;
}

export async function createMetricsTenant(name = 'metrics'): Promise<MetricsCtx> {
  const t = await createTenantWithUser(name);
  const session = await prisma.waSession.create({ data: { tenantId: t.tenantId, label: 'chip' } });
  const template = await prisma.template.findFirstOrThrow({ where: { tenantId: t.tenantId } });
  return { ...t, sessionId: session.id, templateId: template.id };
}

export function addGroup(
  ctx: MetricsCtx,
  jid: string,
  opts: { name?: string; memberCount?: number; botIsAdmin?: boolean } = {},
) {
  return prisma.waGroup.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      jid,
      name: opts.name ?? jid,
      memberCount: opts.memberCount ?? 0,
      botIsAdmin: opts.botIsAdmin ?? true,
    },
  });
}

export function addSendLog(
  ctx: MetricsCtx,
  groupJid: string,
  sentAt: string,
  status: 'SENT' | 'ERROR' = 'SENT',
  extra: { batchItemId?: string; error?: string } = {},
) {
  return prisma.sendLog.create({
    data: {
      tenantId: ctx.tenantId,
      groupJid,
      status,
      sentAt: new Date(sentAt),
      ...(extra.batchItemId ? { batchItemId: extra.batchItemId } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    },
  });
}

function newBatch(ctx: MetricsCtx, groupJids: string[]) {
  return prisma.batch.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      templateId: ctx.templateId,
      name: 'metrics',
      groupJids,
      intervalMin: 1,
    },
  });
}

/** Produto enviado com sucesso para cada grupo de `groupJids` no instante `sentAt`. */
export async function addProductSend(
  ctx: MetricsCtx,
  opts: { source: ProductSource; title: string; groupJids: string[]; sentAt: string },
): Promise<{ productId: string; itemId: string }> {
  const product = await prisma.product.create({
    data: {
      tenantId: ctx.tenantId,
      source: opts.source,
      title: opts.title,
      price: 10,
      originalUrl: 'https://example.com/p',
      raw: {},
      images: ['https://example.com/i.jpg'],
    },
  });
  const batch = await newBatch(ctx, opts.groupJids);
  const item = await prisma.batchItem.create({
    data: {
      batchId: batch.id,
      productId: product.id,
      order: 0,
      runAt: new Date(opts.sentAt),
      status: 'SENT',
    },
  });
  for (const jid of opts.groupJids) {
    await addSendLog(ctx, jid, opts.sentAt, 'SENT', { batchItemId: item.id });
  }
  return { productId: product.id, itemId: item.id };
}

/** Cupom enviado com sucesso para um grupo. */
export async function addCouponSend(ctx: MetricsCtx, opts: { groupJid: string; sentAt: string }) {
  const coupon = await prisma.coupon.create({
    data: {
      tenantId: ctx.tenantId,
      store: 'SHOPEE',
      code: `C${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      description: 'cupom',
    },
  });
  const batch = await newBatch(ctx, [opts.groupJid]);
  const item = await prisma.batchItem.create({
    data: {
      batchId: batch.id,
      couponId: coupon.id,
      order: 0,
      runAt: new Date(opts.sentAt),
      status: 'SENT',
    },
  });
  await addSendLog(ctx, opts.groupJid, opts.sentAt, 'SENT', { batchItemId: item.id });
  return coupon;
}
```

Crie `apps/api/test/metrics-sends.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { assertGroupOfTenant } from '../src/lib/metrics/common';
import { getSendsMetrics } from '../src/lib/metrics/sends';
import { cleanupTenant } from './helpers';
import { addGroup, addSendLog, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const G1 = 'sends-g1@g.us';
const G2 = 'sends-g2@g.us';
const range = { from: spMidnight('2025-12-30'), to: spMidnight('2026-01-02') };
let ctx: MetricsCtx;
let other: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('sends');
  other = await createMetricsTenant('sends-other');
  await addGroup(ctx, G1);
  await addGroup(ctx, G2);
  await addGroup(other, 'sends-other@g.us');
  await addSendLog(ctx, G1, '2025-12-31T12:00:00Z'); // 31/12 09h SP (quarta)
  await addSendLog(ctx, G1, '2026-01-01T02:30:00Z'); // 31/12 23h30 SP (quarta)
  await addSendLog(ctx, G2, '2026-01-01T03:30:00Z', 'ERROR', { error: 'timeout' }); // 01/01 00h30 SP (quinta)
  await addSendLog(ctx, G2, '2026-01-01T15:00:00Z', 'ERROR', { error: 'timeout' }); // 01/01 12h SP
  await addSendLog(ctx, G1, '2026-01-01T16:00:00Z', 'ERROR', { error: 'not-admin' }); // 01/01 13h SP
  await addSendLog(other, 'sends-other@g.us', '2026-01-01T12:00:00Z');
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getSendsMetrics', () => {
  it('totaliza sucesso e falha só do tenant', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.totals).toEqual({ total: 5, sent: 2, failed: 3, successRate: 40 });
  });

  it('agrupa por dia no fuso de SP, com dias vazios preenchidos', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.daily).toEqual([
      { date: '2025-12-30', sent: 0, failed: 0 },
      { date: '2025-12-31', sent: 2, failed: 0 },
      { date: '2026-01-01', sent: 0, failed: 3 },
    ]);
  });

  it('distribui por hora local e monta o heatmap 7x24', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.hourly).toHaveLength(24);
    expect(m.hourly[9]).toEqual({ hour: 9, sent: 1, failed: 0 });
    expect(m.hourly[23]).toEqual({ hour: 23, sent: 1, failed: 0 });
    expect(m.hourly[0]).toEqual({ hour: 0, sent: 0, failed: 1 });
    expect(m.heatmap).toHaveLength(168);
    expect(m.heatmap.find((c) => c.weekday === 3 && c.hour === 23)?.count).toBe(1);
    expect(m.heatmap.find((c) => c.weekday === 4 && c.hour === 0)?.count).toBe(1);
    expect(m.heatmap.reduce((s, c) => s + c.count, 0)).toBe(5);
  });

  it('lista os principais erros', async () => {
    const m = await getSendsMetrics(ctx.tenantId, range);
    expect(m.topErrors).toEqual([
      { error: 'timeout', count: 2 },
      { error: 'not-admin', count: 1 },
    ]);
  });

  it('filtra por groupJid', async () => {
    const m = await getSendsMetrics(ctx.tenantId, { ...range, groupJid: G2 });
    expect(m.totals).toEqual({ total: 2, sent: 0, failed: 2, successRate: 0 });
  });

  it('período sem registros devolve zeros', async () => {
    const m = await getSendsMetrics(ctx.tenantId, {
      from: spMidnight('2027-01-01'),
      to: spMidnight('2027-01-03'),
    });
    expect(m.totals).toEqual({ total: 0, sent: 0, failed: 0, successRate: 0 });
    expect(m.daily).toEqual([
      { date: '2027-01-01', sent: 0, failed: 0 },
      { date: '2027-01-02', sent: 0, failed: 0 },
    ]);
    expect(m.topErrors).toEqual([]);
  });
});

describe('assertGroupOfTenant', () => {
  it('aceita grupo do tenant ou ausência de grupo', async () => {
    await expect(assertGroupOfTenant(ctx.tenantId, G1)).resolves.toBeUndefined();
    await expect(assertGroupOfTenant(ctx.tenantId, undefined)).resolves.toBeUndefined();
  });
  it('grupo de outro tenant é 404', async () => {
    await expect(assertGroupOfTenant(ctx.tenantId, 'sends-other@g.us')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-sends.test.ts`
Expected: FAIL com `Failed to load url ../src/lib/metrics/common`.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/api/src/lib/metrics/common.ts`:

```ts
import { Prisma, prisma } from '@afilados/db';
import { ApiError, METRICS_TIMEZONE, spDayKeysInRange } from '@afilados/shared';

/**
 * Instante para comparar com colunas DateTime do Prisma (`timestamp(3)` sem fuso, em UTC).
 * Converte explicitamente para não depender do TimeZone da sessão do Postgres.
 */
export function utc(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** Hora local de SP da coluna. `column` é sempre um literal do código, nunca entrada do usuário. */
export function localTs(column: string): Prisma.Sql {
  return Prisma.raw(`((${column}) AT TIME ZONE 'UTC') AT TIME ZONE '${METRICS_TIMEZONE}'`);
}

/** Dia local de SP (`YYYY-MM-DD`) da coluna. */
export function localDay(column: string): Prisma.Sql {
  return Prisma.raw(
    `to_char(((${column}) AT TIME ZONE 'UTC') AT TIME ZONE '${METRICS_TIMEZONE}', 'YYYY-MM-DD')`,
  );
}

/** `column >= from AND column < to`. */
export function inRange(column: string, from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`${Prisma.raw(column)} >= ${utc(from)} AND ${Prisma.raw(column)} < ${utc(to)}`;
}

/** Percentual com 1 casa; 0 quando o denominador é 0. */
export function pct(num: number, den: number): number {
  return den === 0 ? 0 : Math.round((num / den) * 1000) / 10;
}

/** Uma linha por dia de SP em [from, to), preenchendo os dias sem dados. */
export function fillDays<T extends { date: string }>(
  from: Date,
  to: Date,
  rows: T[],
  empty: (date: string) => T,
): T[] {
  const byDay = new Map(rows.map((r) => [r.date, r]));
  return spDayKeysInRange(from, to).map((date) => byDay.get(date) ?? empty(date));
}

export async function assertGroupOfTenant(tenantId: string, groupJid?: string): Promise<void> {
  if (!groupJid) return;
  const group = await prisma.waGroup.findFirst({
    where: { tenantId, jid: groupJid },
    select: { id: true },
  });
  if (!group) throw ApiError.notFound('Grupo não encontrado');
}

/** Grupos monitorados (bot admin). O mesmo jid em duas sessões conta uma vez (maior contagem). */
export async function adminGroupsOf(
  tenantId: string,
  groupJid?: string,
): Promise<{ jid: string; name: string; memberCount: number }[]> {
  const rows = await prisma.waGroup.findMany({
    where: { tenantId, botIsAdmin: true, ...(groupJid ? { jid: groupJid } : {}) },
    select: { jid: true, name: true, memberCount: true },
    orderBy: { name: 'asc' },
  });
  const byJid = new Map<string, { jid: string; name: string; memberCount: number }>();
  for (const r of rows) {
    const prev = byJid.get(r.jid);
    if (!prev || r.memberCount > prev.memberCount) byJid.set(r.jid, r);
  }
  return [...byJid.values()];
}
```

Crie `apps/api/src/lib/metrics/sends.ts`:

```ts
import { Prisma, prisma } from '@afilados/db';
import type { MetricsQuery, MetricsSends } from '@afilados/shared';
import { fillDays, inRange, localDay, localTs, pct } from './common';

export async function getSendsMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsSends> {
  const where = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"sentAt"', q.from, q.to)}${
    q.groupJid ? Prisma.sql` AND "groupJid" = ${q.groupJid}` : Prisma.empty
  }`;
  const ts = localTs('"sentAt"');
  const [totalsRows, dailyRows, hourlyRows, heatRows, topErrors] = await Promise.all([
    prisma.$queryRaw<{ sent: number; failed: number }[]>`
      SELECT COUNT(*) FILTER (WHERE "status" = 'SENT')::int AS sent,
             COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS failed
      FROM "SendLog" WHERE ${where}`,
    prisma.$queryRaw<{ date: string; sent: number; failed: number }[]>`
      SELECT ${localDay('"sentAt"')} AS date,
             COUNT(*) FILTER (WHERE "status" = 'SENT')::int AS sent,
             COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS failed
      FROM "SendLog" WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ hour: number; sent: number; failed: number }[]>`
      SELECT EXTRACT(HOUR FROM ${ts})::int AS hour,
             COUNT(*) FILTER (WHERE "status" = 'SENT')::int AS sent,
             COUNT(*) FILTER (WHERE "status" = 'ERROR')::int AS failed
      FROM "SendLog" WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ weekday: number; hour: number; count: number }[]>`
      SELECT EXTRACT(DOW FROM ${ts})::int AS weekday,
             EXTRACT(HOUR FROM ${ts})::int AS hour,
             COUNT(*)::int AS count
      FROM "SendLog" WHERE ${where} GROUP BY 1, 2`,
    prisma.$queryRaw<{ error: string; count: number }[]>`
      SELECT LEFT(COALESCE(NULLIF(TRIM("error"), ''), 'Erro sem mensagem'), 200) AS error,
             COUNT(*)::int AS count
      FROM "SendLog" WHERE ${where} AND "status" = 'ERROR'
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 5`,
  ]);

  const sent = totalsRows[0]?.sent ?? 0;
  const failed = totalsRows[0]?.failed ?? 0;
  const byHour = new Map(hourlyRows.map((r) => [r.hour, r]));
  const heat = new Map(heatRows.map((r) => [r.weekday * 24 + r.hour, r.count]));
  const heatmap: MetricsSends['heatmap'] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      heatmap.push({ weekday, hour, count: heat.get(weekday * 24 + hour) ?? 0 });
    }
  }
  return {
    totals: { total: sent + failed, sent, failed, successRate: pct(sent, sent + failed) },
    daily: fillDays(q.from, q.to, dailyRows, (date) => ({ date, sent: 0, failed: 0 })),
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sent: byHour.get(hour)?.sent ?? 0,
      failed: byHour.get(hour)?.failed ?? 0,
    })),
    heatmap,
    topErrors,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-sends.test.ts
pnpm --filter @afilados/api typecheck
```
Expected: 8 testes PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/metrics/common.ts apps/api/src/lib/metrics/sends.ts apps/api/test/metrics-fixtures.ts apps/api/test/metrics-sends.test.ts
git commit -m "feat(api): base do serviço de métricas e painel de envios

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Painéis de produtos e de espelhamento/automações (Trilha B, agente Programador)

**Files:**
- Create: `apps/api/src/lib/metrics/products.ts`
- Create: `apps/api/src/lib/metrics/automation.ts`
- Test: `apps/api/test/metrics-products.test.ts`
- Test: `apps/api/test/metrics-automation.test.ts`

**Interfaces:**
- Consumes: `inRange`, `localDay` (T6); fixtures `addProductSend`, `addCouponSend`, `addSendLog`, `createMetricsTenant` (T6); `MetricsProducts`, `MetricsAutomation`, `spDayKeysInRange` (T1).
- Produces:
  - `getProductsMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsProducts>`: conta `SendLog` `SENT` cujo `BatchItem` tem produto; top 10 por envios e soma por `Product.source`. `groupJid` filtra `SendLog.groupJid`.
  - `getAutomationMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsAutomation>`: `captured` = mensagens de origem distintas (`sourceJid` + `sourceMsgId`) no `MirrorLog`; contagens por status e por ação do `AutomationLog`; `coupons.validated` = `CouponCheck` `VALID`; `coupons.propagated` = `SendLog` `SENT` de `BatchItem` com cupom. `groupJid` filtra `MirrorLog.targetJid` e `SendLog.groupJid` (o `AutomationLog` não tem grupo e não é filtrado).

- [ ] **Step 1: Write the failing tests**

Crie `apps/api/test/metrics-products.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getProductsMetrics } from '../src/lib/metrics/products';
import { cleanupTenant } from './helpers';
import {
  addProductSend,
  addSendLog,
  createMetricsTenant,
  type MetricsCtx,
} from './metrics-fixtures';

const range = { from: spMidnight('2026-03-01'), to: spMidnight('2026-04-01') };
const IN = '2026-03-10T15:00:00Z';
let ctx: MetricsCtx;
let other: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('products');
  other = await createMetricsTenant('products-other');
  const fone = await addProductSend(ctx, {
    source: 'SHOPEE',
    title: 'Fone',
    groupJids: ['p-g1@g.us', 'p-g2@g.us', 'p-g3@g.us'],
    sentAt: IN,
  });
  // falha do mesmo item em outro grupo não conta
  await addSendLog(ctx, 'p-g9@g.us', IN, 'ERROR', { batchItemId: fone.itemId, error: 'x' });
  await addProductSend(ctx, { source: 'AMAZON', title: 'Livro', groupJids: ['p-g4@g.us'], sentAt: IN });
  for (let i = 1; i <= 9; i++) {
    await addProductSend(ctx, {
      source: 'SHOPEE',
      title: `Extra ${i}`,
      groupJids: ['p-x@g.us'],
      sentAt: IN,
    });
  }
  // fora do período
  await addProductSend(ctx, {
    source: 'MERCADOLIVRE',
    title: 'Panela',
    groupJids: ['p-g1@g.us', 'p-g2@g.us'],
    sentAt: '2026-02-01T15:00:00Z',
  });
  await addProductSend(other, {
    source: 'MAGALU',
    title: 'Outro tenant',
    groupJids: ['o@g.us'],
    sentAt: IN,
  });
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getProductsMetrics', () => {
  it('top 10 por envios com sucesso', async () => {
    const m = await getProductsMetrics(ctx.tenantId, range);
    expect(m.top).toHaveLength(10);
    expect(m.top[0]).toMatchObject({
      title: 'Fone',
      source: 'SHOPEE',
      image: 'https://example.com/i.jpg',
      sends: 3,
    });
    expect(m.top.map((p) => p.title)).not.toContain('Panela');
    expect(m.top.map((p) => p.title)).not.toContain('Outro tenant');
  });

  it('distribuição por marketplace', async () => {
    const m = await getProductsMetrics(ctx.tenantId, range);
    expect(m.byMarketplace).toEqual([
      { source: 'SHOPEE', sends: 12 },
      { source: 'AMAZON', sends: 1 },
    ]);
  });

  it('filtra por groupJid', async () => {
    const m = await getProductsMetrics(ctx.tenantId, { ...range, groupJid: 'p-g1@g.us' });
    expect(m.top.map((p) => [p.title, p.sends])).toEqual([['Fone', 1]]);
    expect(m.byMarketplace).toEqual([{ source: 'SHOPEE', sends: 1 }]);
  });

  it('período vazio devolve listas vazias', async () => {
    const m = await getProductsMetrics(ctx.tenantId, {
      from: spMidnight('2030-01-01'),
      to: spMidnight('2030-01-02'),
    });
    expect(m).toEqual({ top: [], byMarketplace: [] });
  });
});
```

Crie `apps/api/test/metrics-automation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@afilados/db';
import { spMidnight } from '@afilados/shared';
import { getAutomationMetrics } from '../src/lib/metrics/automation';
import { cleanupTenant } from './helpers';
import { addCouponSend, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const range = { from: spMidnight('2026-05-01'), to: spMidnight('2026-05-08') };
const T1 = 'a-t1@g.us';
const T2 = 'a-t2@g.us';
let ctx: MetricsCtx;
let other: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('automation');
  other = await createMetricsTenant('automation-other');
  const rule = await prisma.mirrorRule.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      sourceJids: ['src@g.us'],
      targetJids: [T1, T2],
    },
  });
  const mirror = (
    msg: string,
    targetJid: string,
    status: 'MIRRORED' | 'DISCARDED' | 'ERROR',
    at: string,
  ) =>
    prisma.mirrorLog.create({
      data: {
        tenantId: ctx.tenantId,
        ruleId: rule.id,
        sourceJid: 'src@g.us',
        sourceMsgId: msg,
        targetJid,
        status,
        createdAt: new Date(at),
      },
    });
  await mirror('m1', T1, 'MIRRORED', '2026-05-02T12:00:00Z');
  await mirror('m1', T2, 'MIRRORED', '2026-05-02T12:00:00Z');
  await mirror('m2', T1, 'DISCARDED', '2026-05-03T12:00:00Z');
  await mirror('m3', T2, 'ERROR', '2026-05-03T13:00:00Z');
  await mirror('m4', T1, 'MIRRORED', '2026-04-20T12:00:00Z'); // fora do período

  const autoRule = await prisma.automationRule.create({
    data: {
      tenantId: ctx.tenantId,
      name: 'Regra',
      sessionId: ctx.sessionId,
      templateId: ctx.templateId,
      marketplaces: [],
      keywords: [],
      blockedKeywords: [],
      groupJids: [],
    },
  });
  const auto = (action: 'DISCOVERED' | 'DISPATCHED' | 'SKIPPED' | 'ERROR', at: string) =>
    prisma.automationLog.create({
      data: {
        tenantId: ctx.tenantId,
        ruleId: autoRule.id,
        marketplace: 'SHOPEE',
        action,
        createdAt: new Date(at),
      },
    });
  await auto('DISCOVERED', '2026-05-02T10:00:00Z');
  await auto('DISCOVERED', '2026-05-02T11:00:00Z');
  await auto('DISPATCHED', '2026-05-02T12:00:00Z');
  await auto('SKIPPED', '2026-05-04T12:00:00Z');
  await auto('ERROR', '2026-05-05T12:00:00Z');

  const coupon = await prisma.coupon.create({
    data: { tenantId: ctx.tenantId, store: 'SHOPEE', code: 'CHK', description: 'c' },
  });
  const check = (result: 'VALID' | 'INVALID', at: string) =>
    prisma.couponCheck.create({
      data: {
        tenantId: ctx.tenantId,
        couponId: coupon.id,
        result,
        method: 'MANUAL',
        createdAt: new Date(at),
      },
    });
  await check('VALID', '2026-05-02T12:00:00Z');
  await check('VALID', '2026-05-03T12:00:00Z');
  await check('INVALID', '2026-05-03T12:00:00Z');
  await check('VALID', '2026-04-01T12:00:00Z'); // fora do período

  await addCouponSend(ctx, { groupJid: 'a-g1@g.us', sentAt: '2026-05-04T12:00:00Z' });
  await addCouponSend(ctx, { groupJid: 'a-g2@g.us', sentAt: '2026-05-04T13:00:00Z' });

  const otherCoupon = await prisma.coupon.create({
    data: { tenantId: other.tenantId, store: 'SHOPEE', code: 'OTHER', description: 'c' },
  });
  await prisma.couponCheck.create({
    data: {
      tenantId: other.tenantId,
      couponId: otherCoupon.id,
      result: 'VALID',
      method: 'MANUAL',
      createdAt: new Date('2026-05-02T12:00:00Z'),
    },
  });
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getAutomationMetrics', () => {
  it('espelhamento, automação e cupons do período', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, range);
    expect(m.mirror).toEqual({ captured: 3, mirrored: 2, discarded: 1, errors: 1 });
    expect(m.automation).toEqual({ discovered: 2, dispatched: 1, skipped: 1, errors: 1 });
    expect(m.coupons).toEqual({ validated: 2, propagated: 2 });
  });

  it('série diária de espelhadas e disparadas', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, range);
    expect(m.daily).toHaveLength(7);
    expect(m.daily.find((d) => d.date === '2026-05-02')).toEqual({
      date: '2026-05-02',
      mirrored: 2,
      dispatched: 1,
    });
    expect(m.daily.find((d) => d.date === '2026-05-06')).toEqual({
      date: '2026-05-06',
      mirrored: 0,
      dispatched: 0,
    });
  });

  it('groupJid filtra o destino do espelhamento e os envios de cupom', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, { ...range, groupJid: T1 });
    expect(m.mirror).toEqual({ captured: 2, mirrored: 1, discarded: 1, errors: 0 });
    expect(m.coupons.propagated).toBe(0);
  });

  it('período vazio devolve zeros', async () => {
    const m = await getAutomationMetrics(ctx.tenantId, {
      from: spMidnight('2030-01-01'),
      to: spMidnight('2030-01-02'),
    });
    expect(m.mirror).toEqual({ captured: 0, mirrored: 0, discarded: 0, errors: 0 });
    expect(m.automation).toEqual({ discovered: 0, dispatched: 0, skipped: 0, errors: 0 });
    expect(m.coupons).toEqual({ validated: 0, propagated: 0 });
    expect(m.daily).toEqual([{ date: '2030-01-01', mirrored: 0, dispatched: 0 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-products.test.ts test/metrics-automation.test.ts`
Expected: FAIL com `Failed to load url ../src/lib/metrics/products` e `../src/lib/metrics/automation`.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/api/src/lib/metrics/products.ts`:

```ts
import { Prisma, prisma } from '@afilados/db';
import type { MetricsProducts, MetricsQuery } from '@afilados/shared';
import { inRange } from './common';

export async function getProductsMetrics(
  tenantId: string,
  q: MetricsQuery,
): Promise<MetricsProducts> {
  const from = Prisma.sql`
    FROM "SendLog" s
    JOIN "BatchItem" bi ON bi."id" = s."batchItemId"
    JOIN "Product" p ON p."id" = bi."productId"`;
  const where = Prisma.sql`s."tenantId" = ${tenantId} AND p."tenantId" = ${tenantId}
    AND s."status" = 'SENT' AND ${inRange('s."sentAt"', q.from, q.to)}${
      q.groupJid ? Prisma.sql` AND s."groupJid" = ${q.groupJid}` : Prisma.empty
    }`;
  const [top, byMarketplace] = await Promise.all([
    prisma.$queryRaw<MetricsProducts['top']>`
      SELECT p."id" AS "productId", p."title" AS title, p."source"::text AS source,
             p."images"[1] AS image, COUNT(*)::int AS sends
      ${from} WHERE ${where}
      GROUP BY p."id" ORDER BY sends DESC, p."title" ASC LIMIT 10`,
    prisma.$queryRaw<MetricsProducts['byMarketplace']>`
      SELECT p."source"::text AS source, COUNT(*)::int AS sends
      ${from} WHERE ${where}
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC`,
  ]);
  return { top, byMarketplace };
}
```

Crie `apps/api/src/lib/metrics/automation.ts`:

```ts
import { Prisma, prisma, type AutomationLogAction, type MirrorLogStatus } from '@afilados/db';
import { spDayKeysInRange, type MetricsAutomation, type MetricsQuery } from '@afilados/shared';
import { inRange, localDay } from './common';

/** `groupJid` filtra o destino do espelhamento e os envios de cupom; o AutomationLog não tem grupo. */
export async function getAutomationMetrics(
  tenantId: string,
  q: MetricsQuery,
): Promise<MetricsAutomation> {
  const range = { gte: q.from, lt: q.to };
  const mirrorWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"createdAt"', q.from, q.to)}${
    q.groupJid ? Prisma.sql` AND "targetJid" = ${q.groupJid}` : Prisma.empty
  }`;
  const autoWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"createdAt"', q.from, q.to)}`;

  const [mirrorRows, capturedRows, autoRows, validated, propagated, mirrorDaily, dispatchDaily] =
    await Promise.all([
      prisma.mirrorLog.groupBy({
        by: ['status'],
        where: { tenantId, createdAt: range, ...(q.groupJid ? { targetJid: q.groupJid } : {}) },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ captured: number }[]>`
        SELECT COUNT(DISTINCT "sourceJid" || ':' || "sourceMsgId")::int AS captured
        FROM "MirrorLog" WHERE ${mirrorWhere}`,
      prisma.automationLog.groupBy({
        by: ['action'],
        where: { tenantId, createdAt: range },
        _count: { _all: true },
      }),
      prisma.couponCheck.count({ where: { tenantId, result: 'VALID', createdAt: range } }),
      prisma.sendLog.count({
        where: {
          tenantId,
          status: 'SENT',
          sentAt: range,
          batchItem: { couponId: { not: null } },
          ...(q.groupJid ? { groupJid: q.groupJid } : {}),
        },
      }),
      prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT ${localDay('"createdAt"')} AS date, COUNT(*)::int AS count
        FROM "MirrorLog" WHERE ${mirrorWhere} AND "status" = 'MIRRORED' GROUP BY 1`,
      prisma.$queryRaw<{ date: string; count: number }[]>`
        SELECT ${localDay('"createdAt"')} AS date, COUNT(*)::int AS count
        FROM "AutomationLog" WHERE ${autoWhere} AND "action" = 'DISPATCHED' GROUP BY 1`,
    ]);

  const mirrorCount = (s: MirrorLogStatus) =>
    mirrorRows.find((r) => r.status === s)?._count._all ?? 0;
  const autoCount = (a: AutomationLogAction) =>
    autoRows.find((r) => r.action === a)?._count._all ?? 0;
  const mirroredByDay = new Map(mirrorDaily.map((r) => [r.date, r.count]));
  const dispatchedByDay = new Map(dispatchDaily.map((r) => [r.date, r.count]));

  return {
    mirror: {
      captured: capturedRows[0]?.captured ?? 0,
      mirrored: mirrorCount('MIRRORED'),
      discarded: mirrorCount('DISCARDED'),
      errors: mirrorCount('ERROR'),
    },
    automation: {
      discovered: autoCount('DISCOVERED'),
      dispatched: autoCount('DISPATCHED'),
      skipped: autoCount('SKIPPED'),
      errors: autoCount('ERROR'),
    },
    coupons: { validated, propagated },
    daily: spDayKeysInRange(q.from, q.to).map((date) => ({
      date,
      mirrored: mirroredByDay.get(date) ?? 0,
      dispatched: dispatchedByDay.get(date) ?? 0,
    })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-products.test.ts test/metrics-automation.test.ts
pnpm --filter @afilados/api typecheck
```
Expected: 8 testes PASS (4 + 4); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/metrics/products.ts apps/api/src/lib/metrics/automation.ts apps/api/test/metrics-products.test.ts apps/api/test/metrics-automation.test.ts
git commit -m "feat(api): métricas de produtos, espelhamento, automações e cupons

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Painéis de grupos e de cliques (Trilha B, agente Programador; depende de T2)

Antes de começar: `git merge feat/dashboard-metricas-a` (precisa do commit de T2), `pnpm db:generate` e `.superpowers/sdd/remote.sh setup` para aplicar a migration no servidor.

**Files:**
- Modify: `apps/api/test/metrics-fixtures.ts` (fábricas de eventos, snapshots, links e cliques)
- Create: `apps/api/src/lib/metrics/groups.ts`
- Create: `apps/api/src/lib/metrics/clicks.ts`
- Test: `apps/api/test/metrics-groups.test.ts`
- Test: `apps/api/test/metrics-clicks.test.ts`

**Interfaces:**
- Consumes: `prisma.groupMemberEvent`, `prisma.groupSnapshot`, `prisma.linkClickEvent` (T2); `adminGroupsOf`, `fillDays`, `inRange`, `localDay` (T6); `MetricsGroups`, `MetricsGroupRow`, `MetricsClicks`, `spMidnight` (T1).
- Produces:
  - `getTrackingSince(tenantId: string): Promise<string | null>` (ISO do menor entre o primeiro `GroupMemberEvent.occurredAt` e o primeiro `GroupSnapshot.createdAt` do tenant)
  - `getGroupsMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsGroups>`: entradas = `JOIN` + `ADDED`; saídas = `LEAVE` + `REMOVED`; `PROMOTED`/`DEMOTED` não contam; membros vêm de `WaGroup.memberCount` (grupos com bot admin); série com saldo acumulado e soma dos snapshots do dia.
  - `getClicksMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsClicks>`: `groupJid` filtra `LinkClickEvent.targetGroupJid`.
  - Fixtures: `addMemberEvent(ctx, groupJid, action, occurredAt)`, `addSnapshot(ctx, groupJid, day, memberCount)`, `addGroupLink(ctx, slug, label)`, `addClick(ctx, groupLinkId, slug, clickedAt, targetGroupJid?)`

- [ ] **Step 1: Write the failing tests**

Em `apps/api/test/metrics-fixtures.ts`, troque a primeira linha (`import { prisma, type ProductSource } from '@afilados/db';`) por:

```ts
import { randomUUID } from 'node:crypto';
import { prisma, type GroupMemberAction, type ProductSource } from '@afilados/db';
import { spMidnight } from '@afilados/shared';
```

E acrescente ao fim do arquivo:

```ts
export function addMemberEvent(
  ctx: MetricsCtx,
  groupJid: string,
  action: GroupMemberAction,
  occurredAt: string,
) {
  return prisma.groupMemberEvent.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      groupJid,
      participantJid: `${randomUUID()}@s.whatsapp.net`,
      action,
      occurredAt: new Date(occurredAt),
      dedupeKey: `fx-${randomUUID()}`,
    },
  });
}

/** `day` no formato YYYY-MM-DD (dia de SP). */
export function addSnapshot(ctx: MetricsCtx, groupJid: string, day: string, memberCount: number) {
  return prisma.groupSnapshot.create({
    data: {
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
      groupJid,
      date: spMidnight(day),
      memberCount,
    },
  });
}

export function addGroupLink(ctx: MetricsCtx, slug: string, label: string) {
  return prisma.groupLink.create({
    data: { tenantId: ctx.tenantId, sessionId: ctx.sessionId, slug, label, baseName: label },
  });
}

export function addClick(
  ctx: MetricsCtx,
  groupLinkId: string,
  slug: string,
  clickedAt: string,
  targetGroupJid: string | null = null,
) {
  return prisma.linkClickEvent.create({
    data: {
      tenantId: ctx.tenantId,
      groupLinkId,
      slug,
      targetGroupJid,
      clickedAt: new Date(clickedAt),
    },
  });
}
```

Crie `apps/api/test/metrics-groups.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getGroupsMetrics, getTrackingSince } from '../src/lib/metrics/groups';
import { cleanupTenant } from './helpers';
import {
  addGroup,
  addMemberEvent,
  addSnapshot,
  createMetricsTenant,
  type MetricsCtx,
} from './metrics-fixtures';

const G1 = 'gr-g1@g.us';
const G2 = 'gr-g2@g.us';
const G3 = 'gr-g3@g.us';
const range = { from: spMidnight('2026-06-01'), to: spMidnight('2026-06-04') };
let ctx: MetricsCtx;
let other: MetricsCtx;
let empty: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('groups');
  other = await createMetricsTenant('groups-other');
  empty = await createMetricsTenant('groups-empty');
  await addGroup(ctx, G1, { name: 'Alfa', memberCount: 100 });
  await addGroup(ctx, G2, { name: 'Beta', memberCount: 50 });
  await addGroup(ctx, G3, { name: 'Comum', memberCount: 30, botIsAdmin: false });
  await addGroup(other, 'gr-other@g.us', { name: 'Outro', memberCount: 999 });

  await addMemberEvent(ctx, G1, 'JOIN', '2026-05-31T12:00:00Z'); // fora do período
  await addMemberEvent(ctx, G1, 'JOIN', '2026-06-01T12:00:00Z');
  await addMemberEvent(ctx, G1, 'ADDED', '2026-06-01T13:00:00Z');
  await addMemberEvent(ctx, G1, 'LEAVE', '2026-06-02T12:00:00Z');
  await addMemberEvent(ctx, G1, 'PROMOTED', '2026-06-02T12:30:00Z');
  await addMemberEvent(ctx, G1, 'JOIN', '2026-06-04T02:00:00Z'); // 03/06 23h em SP
  await addMemberEvent(ctx, G2, 'REMOVED', '2026-06-03T12:00:00Z');
  await addMemberEvent(ctx, G2, 'LEAVE', '2026-06-03T13:00:00Z');
  await addMemberEvent(other, 'gr-other@g.us', 'JOIN', '2026-06-01T12:00:00Z');

  await addSnapshot(ctx, G1, '2026-06-01', 98);
  await addSnapshot(ctx, G2, '2026-06-01', 52);
  await addSnapshot(ctx, G1, '2026-06-03', 100);
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
  await cleanupTenant(empty.tenantId);
});

describe('getGroupsMetrics', () => {
  it('totais do período só com grupos monitorados do tenant', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, range);
    expect(m.totals).toEqual({ members: 150, joins: 3, leaves: 3, net: 0 });
  });

  it('série diária em SP com saldo acumulado e snapshots', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, range);
    expect(m.series).toEqual([
      { date: '2026-06-01', joins: 2, leaves: 0, net: 2, cumulativeNet: 2, members: 150 },
      { date: '2026-06-02', joins: 0, leaves: 1, net: -1, cumulativeNet: 1, members: null },
      { date: '2026-06-03', joins: 1, leaves: 2, net: -1, cumulativeNet: 0, members: 100 },
    ]);
  });

  it('tabela por grupo ordenada por saldo', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, range);
    expect(m.groups).toEqual([
      { jid: G1, name: 'Alfa', members: 100, joins: 3, leaves: 1, net: 2, growthPct: 2 },
      { jid: G2, name: 'Beta', members: 50, joins: 0, leaves: 2, net: -2, growthPct: -3.8 },
    ]);
  });

  it('filtra por groupJid', async () => {
    const m = await getGroupsMetrics(ctx.tenantId, { ...range, groupJid: G2 });
    expect(m.totals).toEqual({ members: 50, joins: 0, leaves: 2, net: -2 });
    expect(m.groups.map((g) => g.jid)).toEqual([G2]);
  });

  it('trackingSince é o primeiro evento ou snapshot', async () => {
    expect(await getTrackingSince(ctx.tenantId)).toBe('2026-05-31T12:00:00.000Z');
    expect(await getTrackingSince(empty.tenantId)).toBeNull();
  });

  it('tenant sem dados devolve zeros', async () => {
    const m = await getGroupsMetrics(empty.tenantId, range);
    expect(m.trackingSince).toBeNull();
    expect(m.totals).toEqual({ members: 0, joins: 0, leaves: 0, net: 0 });
    expect(m.groups).toEqual([]);
    expect(m.series).toHaveLength(3);
    expect(m.series[0]).toEqual({
      date: '2026-06-01',
      joins: 0,
      leaves: 0,
      net: 0,
      cumulativeNet: 0,
      members: null,
    });
  });
});
```

Crie `apps/api/test/metrics-clicks.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getClicksMetrics } from '../src/lib/metrics/clicks';
import { cleanupTenant } from './helpers';
import { addClick, addGroupLink, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const range = { from: spMidnight('2026-07-01'), to: spMidnight('2026-07-03') };
const suffix = Date.now();
const ofertas = `ck-ofertas-${suffix}`;
const cupons = `ck-cupons-${suffix}`;
let ctx: MetricsCtx;
let other: MetricsCtx;
let ofertasId: string;
let cuponsId: string;

beforeAll(async () => {
  ctx = await createMetricsTenant('clicks');
  other = await createMetricsTenant('clicks-other');
  ofertasId = (await addGroupLink(ctx, ofertas, 'Ofertas')).id;
  cuponsId = (await addGroupLink(ctx, cupons, 'Cupons')).id;
  const otherLink = await addGroupLink(other, `ck-other-${suffix}`, 'Outro');

  await addClick(ctx, ofertasId, ofertas, '2026-07-01T12:00:00Z', 'ck-g1@g.us');
  await addClick(ctx, ofertasId, ofertas, '2026-07-01T13:00:00Z', 'ck-g1@g.us');
  await addClick(ctx, ofertasId, ofertas, '2026-07-02T02:30:00Z', 'ck-g1@g.us'); // 01/07 23h30 SP
  await addClick(ctx, cuponsId, cupons, '2026-07-02T12:00:00Z');
  await addClick(ctx, ofertasId, ofertas, '2026-06-30T12:00:00Z', 'ck-g1@g.us'); // fora
  await addClick(other, otherLink.id, otherLink.slug, '2026-07-01T12:00:00Z');
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
  await cleanupTenant(other.tenantId);
});

describe('getClicksMetrics', () => {
  it('total, série diária em SP e ranking por link', async () => {
    const m = await getClicksMetrics(ctx.tenantId, range);
    expect(m.total).toBe(4);
    expect(m.daily).toEqual([
      { date: '2026-07-01', clicks: 3 },
      { date: '2026-07-02', clicks: 1 },
    ]);
    expect(m.byLink).toEqual([
      { groupLinkId: ofertasId, slug: ofertas, label: 'Ofertas', clicks: 3 },
      { groupLinkId: cuponsId, slug: cupons, label: 'Cupons', clicks: 1 },
    ]);
  });

  it('filtra pelo grupo de destino', async () => {
    const m = await getClicksMetrics(ctx.tenantId, { ...range, groupJid: 'ck-g1@g.us' });
    expect(m.total).toBe(3);
    expect(m.byLink.map((l) => l.slug)).toEqual([ofertas]);
  });

  it('período vazio devolve zeros', async () => {
    const m = await getClicksMetrics(ctx.tenantId, {
      from: spMidnight('2030-01-01'),
      to: spMidnight('2030-01-02'),
    });
    expect(m).toEqual({ total: 0, daily: [{ date: '2030-01-01', clicks: 0 }], byLink: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-groups.test.ts test/metrics-clicks.test.ts`
Expected: FAIL com `Failed to load url ../src/lib/metrics/groups` e `../src/lib/metrics/clicks`.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/api/src/lib/metrics/groups.ts`:

```ts
import { Prisma, prisma } from '@afilados/db';
import type { MetricsGroupRow, MetricsGroups, MetricsQuery } from '@afilados/shared';
import { adminGroupsOf, fillDays, inRange, localDay } from './common';

export async function getTrackingSince(tenantId: string): Promise<string | null> {
  const [ev, snap] = await Promise.all([
    prisma.groupMemberEvent.aggregate({ where: { tenantId }, _min: { occurredAt: true } }),
    prisma.groupSnapshot.aggregate({ where: { tenantId }, _min: { createdAt: true } }),
  ]);
  const dates = [ev._min.occurredAt, snap._min.createdAt].filter(
    (d): d is Date => d instanceof Date,
  );
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString();
}

export async function getGroupsMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsGroups> {
  const byGroup = q.groupJid ? Prisma.sql` AND "groupJid" = ${q.groupJid}` : Prisma.empty;
  const evWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"occurredAt"', q.from, q.to)}${byGroup}`;
  const counts = Prisma.sql`
    COUNT(*) FILTER (WHERE "action" IN ('JOIN', 'ADDED'))::int AS joins,
    COUNT(*) FILTER (WHERE "action" IN ('LEAVE', 'REMOVED'))::int AS leaves`;

  const [groups, perGroup, perDay, snapDays, trackingSince] = await Promise.all([
    adminGroupsOf(tenantId, q.groupJid),
    prisma.$queryRaw<{ groupJid: string; joins: number; leaves: number }[]>`
      SELECT "groupJid", ${counts} FROM "GroupMemberEvent" WHERE ${evWhere} GROUP BY 1`,
    prisma.$queryRaw<{ date: string; joins: number; leaves: number }[]>`
      SELECT ${localDay('"occurredAt"')} AS date, ${counts}
      FROM "GroupMemberEvent" WHERE ${evWhere} GROUP BY 1`,
    prisma.$queryRaw<{ date: string; members: number }[]>`
      SELECT ${localDay('"date"')} AS date, SUM("memberCount")::int AS members
      FROM "GroupSnapshot"
      WHERE "tenantId" = ${tenantId} AND ${inRange('"date"', q.from, q.to)}${byGroup}
      GROUP BY 1`,
    getTrackingSince(tenantId),
  ]);

  const moves = new Map(perGroup.map((r) => [r.groupJid, r]));
  const rows: MetricsGroupRow[] = groups
    .map((g) => {
      const joins = moves.get(g.jid)?.joins ?? 0;
      const leaves = moves.get(g.jid)?.leaves ?? 0;
      const net = joins - leaves;
      const start = g.memberCount - net;
      return {
        jid: g.jid,
        name: g.name,
        members: g.memberCount,
        joins,
        leaves,
        net,
        growthPct: start > 0 ? Math.round((net / start) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'pt-BR'));

  const membersByDay = new Map(snapDays.map((r) => [r.date, r.members]));
  let cumulative = 0;
  const series = fillDays(q.from, q.to, perDay, (date) => ({ date, joins: 0, leaves: 0 })).map(
    (d) => {
      const net = d.joins - d.leaves;
      cumulative += net;
      return {
        date: d.date,
        joins: d.joins,
        leaves: d.leaves,
        net,
        cumulativeNet: cumulative,
        members: membersByDay.get(d.date) ?? null,
      };
    },
  );

  const joins = perGroup.reduce((s, r) => s + r.joins, 0);
  const leaves = perGroup.reduce((s, r) => s + r.leaves, 0);
  return {
    trackingSince,
    totals: {
      members: rows.reduce((s, r) => s + r.members, 0),
      joins,
      leaves,
      net: joins - leaves,
    },
    series,
    groups: rows,
  };
}
```

Crie `apps/api/src/lib/metrics/clicks.ts`:

```ts
import { Prisma, prisma } from '@afilados/db';
import type { MetricsClicks, MetricsQuery } from '@afilados/shared';
import { fillDays, inRange, localDay } from './common';

/** `groupJid` filtra pelo grupo de destino do redirecionamento. */
export async function getClicksMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsClicks> {
  const where = {
    tenantId,
    clickedAt: { gte: q.from, lt: q.to },
    ...(q.groupJid ? { targetGroupJid: q.groupJid } : {}),
  };
  const sqlWhere = Prisma.sql`"tenantId" = ${tenantId} AND ${inRange('"clickedAt"', q.from, q.to)}${
    q.groupJid ? Prisma.sql` AND "targetGroupJid" = ${q.groupJid}` : Prisma.empty
  }`;
  const [total, dailyRows, perLink] = await Promise.all([
    prisma.linkClickEvent.count({ where }),
    prisma.$queryRaw<{ date: string; clicks: number }[]>`
      SELECT ${localDay('"clickedAt"')} AS date, COUNT(*)::int AS clicks
      FROM "LinkClickEvent" WHERE ${sqlWhere} GROUP BY 1`,
    prisma.linkClickEvent.groupBy({ by: ['groupLinkId'], where, _count: { _all: true } }),
  ]);
  const links = await prisma.groupLink.findMany({
    where: { tenantId, id: { in: perLink.map((r) => r.groupLinkId) } },
    select: { id: true, slug: true, label: true },
  });
  const byId = new Map(links.map((l) => [l.id, l]));
  const byLink = perLink
    .map((r) => ({
      groupLinkId: r.groupLinkId,
      slug: byId.get(r.groupLinkId)?.slug ?? '',
      label: byId.get(r.groupLinkId)?.label ?? '',
      clicks: r._count._all,
    }))
    .sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label, 'pt-BR'));
  return {
    total,
    daily: fillDays(q.from, q.to, dailyRows, (date) => ({ date, clicks: 0 })),
    byLink,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-groups.test.ts test/metrics-clicks.test.ts
pnpm --filter @afilados/api typecheck
```
Expected: 9 testes PASS (6 + 3); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/metrics/groups.ts apps/api/src/lib/metrics/clicks.ts apps/api/test/metrics-fixtures.ts apps/api/test/metrics-groups.test.ts apps/api/test/metrics-clicks.test.ts
git commit -m "feat(api): métricas de grupos e de cliques em links

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Painel de visão geral com comparação ao período anterior (Trilha B, agente Programador)

**Files:**
- Create: `apps/api/src/lib/metrics/overview.ts`
- Test: `apps/api/test/metrics-overview.test.ts`

**Interfaces:**
- Consumes: `adminGroupsOf`, `pct` (T6); `getTrackingSince` (T8); fixtures `addGroup`, `addSendLog` (T6), `addMemberEvent`, `addGroupLink`, `addClick` (T8); `previousRange`, `metricsDelta`, `MetricsOverview` (T1).
- Produces: `getOverviewMetrics(tenantId: string, q: MetricsQuery): Promise<MetricsOverview>`. O período anterior é `previousRange(q.from, q.to)` (mesmo tamanho, imediatamente antes). `members.current` = soma de `memberCount` dos grupos monitorados agora; `members.previous` = `current − saldo do período`. `groupOptions` lista sempre todos os grupos monitorados do tenant (ignora `groupJid`), ordenados por nome.

- [ ] **Step 1: Write the failing test**

Crie `apps/api/test/metrics-overview.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spMidnight } from '@afilados/shared';
import { getOverviewMetrics } from '../src/lib/metrics/overview';
import { cleanupTenant } from './helpers';
import {
  addClick,
  addGroup,
  addGroupLink,
  addMemberEvent,
  addSendLog,
  createMetricsTenant,
  type MetricsCtx,
} from './metrics-fixtures';

const OV1 = 'ov-g1@g.us';
const OV2 = 'ov-g2@g.us';
const range = { from: spMidnight('2026-08-08'), to: spMidnight('2026-08-15') };
let ctx: MetricsCtx;

beforeAll(async () => {
  ctx = await createMetricsTenant('overview');
  await addGroup(ctx, OV1, { name: 'Zeta', memberCount: 200 });
  await addGroup(ctx, OV2, { name: 'Alfa', memberCount: 100 });
  await addGroup(ctx, 'ov-g3@g.us', { name: 'Comum', memberCount: 70, botIsAdmin: false });

  // período atual
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-09T12:00:00Z');
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-09T13:00:00Z');
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-09T14:00:00Z');
  await addMemberEvent(ctx, OV1, 'LEAVE', '2026-08-10T12:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T15:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T16:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T17:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-09T18:00:00Z', 'ERROR', { error: 'x' });
  const link = await addGroupLink(ctx, `ov-${Date.now()}`, 'Link');
  await addClick(ctx, link.id, link.slug, '2026-08-09T12:00:00Z', OV1);
  await addClick(ctx, link.id, link.slug, '2026-08-09T13:00:00Z', OV1);

  // período anterior (01/08 a 07/08)
  await addMemberEvent(ctx, OV1, 'JOIN', '2026-08-02T12:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-02T15:00:00Z');
  await addSendLog(ctx, OV1, '2026-08-02T16:00:00Z');
});

afterAll(async () => {
  await cleanupTenant(ctx.tenantId);
});

describe('getOverviewMetrics', () => {
  it('KPIs com variação vs período anterior', async () => {
    const m = await getOverviewMetrics(ctx.tenantId, range);
    expect(m.kpis).toEqual({
      members: { current: 300, previous: 298, changePct: 0.7 },
      joins: { current: 3, previous: 1, changePct: 200 },
      leaves: { current: 1, previous: 0, changePct: null },
      net: { current: 2, previous: 1, changePct: 100 },
      sends: { current: 4, previous: 2, changePct: 100 },
      successRate: { current: 75, previous: 100, changePct: -25 },
      clicks: { current: 2, previous: 0, changePct: null },
    });
  });

  it('informa os intervalos, o início da coleta e os grupos do seletor', async () => {
    const m = await getOverviewMetrics(ctx.tenantId, range);
    expect(m.range).toEqual({
      from: '2026-08-08T03:00:00.000Z',
      to: '2026-08-15T03:00:00.000Z',
      previousFrom: '2026-08-01T03:00:00.000Z',
      previousTo: '2026-08-08T03:00:00.000Z',
    });
    expect(m.trackingSince).toBe('2026-08-02T12:00:00.000Z');
    expect(m.groupOptions).toEqual([
      { jid: OV2, name: 'Alfa' },
      { jid: OV1, name: 'Zeta' },
    ]);
  });

  it('groupJid filtra os KPIs mas não o seletor', async () => {
    const m = await getOverviewMetrics(ctx.tenantId, { ...range, groupJid: OV2 });
    expect(m.kpis.members).toEqual({ current: 100, previous: 100, changePct: 0 });
    expect(m.kpis.joins.current).toBe(0);
    expect(m.kpis.sends.current).toBe(0);
    expect(m.kpis.clicks.current).toBe(0);
    expect(m.groupOptions).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-overview.test.ts`
Expected: FAIL com `Failed to load url ../src/lib/metrics/overview`.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/api/src/lib/metrics/overview.ts`:

```ts
import { prisma } from '@afilados/db';
import {
  metricsDelta,
  previousRange,
  type MetricsOverview,
  type MetricsQuery,
} from '@afilados/shared';
import { adminGroupsOf, pct } from './common';
import { getTrackingSince } from './groups';

async function kpiValues(tenantId: string, q: MetricsQuery) {
  const range = { gte: q.from, lt: q.to };
  const byGroup = q.groupJid ? { groupJid: q.groupJid } : {};
  const [joins, leaves, sends, clicks] = await Promise.all([
    prisma.groupMemberEvent.count({
      where: { tenantId, occurredAt: range, action: { in: ['JOIN', 'ADDED'] }, ...byGroup },
    }),
    prisma.groupMemberEvent.count({
      where: { tenantId, occurredAt: range, action: { in: ['LEAVE', 'REMOVED'] }, ...byGroup },
    }),
    prisma.sendLog.groupBy({
      by: ['status'],
      where: { tenantId, sentAt: range, ...byGroup },
      _count: { _all: true },
    }),
    prisma.linkClickEvent.count({
      where: {
        tenantId,
        clickedAt: range,
        ...(q.groupJid ? { targetGroupJid: q.groupJid } : {}),
      },
    }),
  ]);
  const sent = sends.find((s) => s.status === 'SENT')?._count._all ?? 0;
  const failed = sends.find((s) => s.status === 'ERROR')?._count._all ?? 0;
  return {
    joins,
    leaves,
    net: joins - leaves,
    sends: sent + failed,
    successRate: pct(sent, sent + failed),
    clicks,
  };
}

export async function getOverviewMetrics(
  tenantId: string,
  q: MetricsQuery,
): Promise<MetricsOverview> {
  const prev = previousRange(q.from, q.to);
  const prevQuery: MetricsQuery = { ...q, from: prev.from, to: prev.to };
  const [cur, before, groups, allGroups, trackingSince] = await Promise.all([
    kpiValues(tenantId, q),
    kpiValues(tenantId, prevQuery),
    adminGroupsOf(tenantId, q.groupJid),
    adminGroupsOf(tenantId),
    getTrackingSince(tenantId),
  ]);
  const membersNow = groups.reduce((s, g) => s + g.memberCount, 0);
  return {
    range: {
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      previousFrom: prev.from.toISOString(),
      previousTo: prev.to.toISOString(),
    },
    trackingSince,
    groupOptions: allGroups.map(({ jid, name }) => ({ jid, name })),
    kpis: {
      members: metricsDelta(membersNow, membersNow - cur.net),
      joins: metricsDelta(cur.joins, before.joins),
      leaves: metricsDelta(cur.leaves, before.leaves),
      net: metricsDelta(cur.net, before.net),
      sends: metricsDelta(cur.sends, before.sends),
      successRate: metricsDelta(cur.successRate, before.successRate),
      clicks: metricsDelta(cur.clicks, before.clicks),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-overview.test.ts
pnpm --filter @afilados/api typecheck
```
Expected: 3 testes PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/metrics/overview.ts apps/api/test/metrics-overview.test.ts
git commit -m "feat(api): visão geral de métricas com comparação ao período anterior

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Rotas `GET /api/v1/metrics/*` (Trilha B, agente Programador)

**Files:**
- Create: `apps/api/src/routes/metrics.ts`
- Modify: `apps/api/src/app.ts` (import + `api.register(metricsRoutes)` logo após `overviewRoutes`)
- Test: `apps/api/test/metrics-routes.test.ts`

**Interfaces:**
- Consumes: `metricsQuerySchema` (T1); `assertGroupOfTenant`, `getSendsMetrics` (T6); `getProductsMetrics`, `getAutomationMetrics` (T7); `getGroupsMetrics`, `getClicksMetrics` (T8); `getOverviewMetrics` (T9).
- Produces (consumido pela web a partir de T11):
  - `GET /api/v1/metrics/overview` → `MetricsOverview`
  - `GET /api/v1/metrics/groups` → `MetricsGroups`
  - `GET /api/v1/metrics/sends` → `MetricsSends`
  - `GET /api/v1/metrics/products` → `MetricsProducts`
  - `GET /api/v1/metrics/clicks` → `MetricsClicks`
  - `GET /api/v1/metrics/automation` → `MetricsAutomation`
  - Query: `from`, `to` (ISO 8601, obrigatórios, ≤ 366 dias), `groupJid` (opcional). Erros: 401 sem sessão; 400 `VALIDATION` para query inválida; 404 `NOT_FOUND` para grupo de outro tenant.

- [ ] **Step 1: Write the failing test**

Crie `apps/api/test/metrics-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { cleanupTenant, loginCookie } from './helpers';
import { addGroup, addSendLog, createMetricsTenant, type MetricsCtx } from './metrics-fixtures';

const app = await buildApp({ logger: false });
const from = '2026-09-01T03:00:00.000Z';
const to = '2026-09-08T03:00:00.000Z';
const qs = (extra = '') => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${extra}`;
let a: MetricsCtx;
let b: MetricsCtx;
let cookie: string;

beforeAll(async () => {
  a = await createMetricsTenant('routes-a');
  b = await createMetricsTenant('routes-b');
  cookie = await loginCookie(app, a.email, a.password);
  await addGroup(a, 'rt-a@g.us', { name: 'A', memberCount: 10 });
  await addGroup(b, 'rt-b@g.us', { name: 'B', memberCount: 99 });
  await addSendLog(a, 'rt-a@g.us', '2026-09-02T12:00:00Z');
  await addSendLog(b, 'rt-b@g.us', '2026-09-02T12:00:00Z');
  await addSendLog(b, 'rt-b@g.us', '2026-09-02T13:00:00Z', 'ERROR', { error: 'x' });
});

afterAll(async () => {
  await cleanupTenant(a.tenantId);
  await cleanupTenant(b.tenantId);
  await app.close();
});

const get = (path: string, withCookie = true) =>
  app.inject({ method: 'GET', url: `/api/v1${path}`, headers: withCookie ? { cookie } : {} });

describe('rotas /metrics', () => {
  it('exigem autenticação', async () => {
    const res = await get(`/metrics/overview?${qs()}`, false);
    expect(res.statusCode).toBe(401);
  });

  it.each(['overview', 'groups', 'sends', 'products', 'clicks', 'automation'])(
    'GET /metrics/%s responde 200',
    async (panel) => {
      const res = await get(`/metrics/${panel}?${qs()}`);
      expect(res.statusCode).toBe(200);
    },
  );

  it.each([
    ['sem from', `to=${encodeURIComponent(to)}`],
    ['sem to', `from=${encodeURIComponent(from)}`],
    ['data inválida', `from=abc&to=${encodeURIComponent(to)}`],
    ['to antes de from', `from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`],
    ['mais de 366 dias', 'from=2025-01-01T00:00:00Z&to=2026-01-03T00:00:00Z'],
  ])('400 quando %s', async (_label, query) => {
    const res = await get(`/metrics/sends?${query}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('grupo de outro tenant devolve 404', async () => {
    const res = await get(`/metrics/sends?${qs('&groupJid=rt-b%40g.us')}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('grupo do próprio tenant filtra', async () => {
    const res = await get(`/metrics/sends?${qs('&groupJid=rt-a%40g.us')}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().totals.total).toBe(1);
  });

  it('não vaza dados de outro tenant', async () => {
    const sends = (await get(`/metrics/sends?${qs()}`)).json();
    expect(sends.totals).toEqual({ total: 1, sent: 1, failed: 0, successRate: 100 });
    expect(sends.heatmap).toHaveLength(168);
    const overview = (await get(`/metrics/overview?${qs()}`)).json();
    expect(overview.kpis.sends.current).toBe(1);
    expect(overview.kpis.members.current).toBe(10);
    expect(overview.groupOptions).toEqual([{ jid: 'rt-a@g.us', name: 'A' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-routes.test.ts`
Expected: FAIL; as rotas respondem 404 (`Rota não encontrada`) em vez de 401/200/400.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/api/src/routes/metrics.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { metricsQuerySchema, type MetricsQuery } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { assertGroupOfTenant } from '../lib/metrics/common';
import { getAutomationMetrics } from '../lib/metrics/automation';
import { getClicksMetrics } from '../lib/metrics/clicks';
import { getGroupsMetrics } from '../lib/metrics/groups';
import { getOverviewMetrics } from '../lib/metrics/overview';
import { getProductsMetrics } from '../lib/metrics/products';
import { getSendsMetrics } from '../lib/metrics/sends';

/** Valida a query (ZodError → 400) e garante que o grupo filtrado é do tenant (senão 404). */
async function parseQuery(req: FastifyRequest): Promise<MetricsQuery> {
  const q = metricsQuerySchema.parse(req.query);
  await assertGroupOfTenant(req.tenantId, q.groupJid);
  return q;
}

export async function metricsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/metrics/overview', async (req) =>
    getOverviewMetrics(req.tenantId, await parseQuery(req)),
  );
  app.get('/metrics/groups', async (req) => getGroupsMetrics(req.tenantId, await parseQuery(req)));
  app.get('/metrics/sends', async (req) => getSendsMetrics(req.tenantId, await parseQuery(req)));
  app.get('/metrics/products', async (req) =>
    getProductsMetrics(req.tenantId, await parseQuery(req)),
  );
  app.get('/metrics/clicks', async (req) => getClicksMetrics(req.tenantId, await parseQuery(req)));
  app.get('/metrics/automation', async (req) =>
    getAutomationMetrics(req.tenantId, await parseQuery(req)),
  );
}
```

Em `apps/api/src/app.ts`, acrescente o import logo após `import { overviewRoutes } from './routes/overview';`:

```ts
import { metricsRoutes } from './routes/metrics';
```

E o registro logo após `await api.register(overviewRoutes);`:

```ts
      await api.register(metricsRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.superpowers/sdd/remote.sh run pnpm --filter @afilados/api exec vitest run test/metrics-routes.test.ts test/metrics-sends.test.ts test/metrics-products.test.ts test/metrics-automation.test.ts test/metrics-groups.test.ts test/metrics-clicks.test.ts test/metrics-overview.test.ts
pnpm --filter @afilados/api typecheck
```
Expected: `metrics-routes.test.ts` com 15 testes PASS e as demais suítes de métricas continuam PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/metrics.ts apps/api/src/app.ts apps/api/test/metrics-routes.test.ts
git commit -m "feat(api): rotas /metrics (overview, groups, sends, products, clicks, automation)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Filtros na URL e hooks de dados da web (Trilha C, agente FrontEnd Designer)

**Files:**
- Modify: `apps/web/package.json` (dependência `recharts`, via `pnpm add`)
- Create: `apps/web/src/lib/metrics-filters.ts`
- Create: `apps/web/src/lib/use-metrics-filters.ts`
- Create: `apps/web/src/lib/metrics-queries.ts`
- Test: `apps/web/test/metrics-filters.test.ts`
- Test: `apps/web/test/metrics-queries.test.tsx`

**Interfaces:**
- Consumes: `METRICS_PERIODS`, `METRICS_MAX_RANGE_DAYS`, `MetricsPeriod`, `periodRange`, `customRange`, `spDayKey`, `spAddDays`, `spDayKeysInRange` e os tipos `Metrics*` (T1); contrato HTTP das rotas (T10).
- Produces:
  - `interface MetricsFilters { period: MetricsPeriod; fromDay: string; toDay: string; groupJid: string | null; from: Date; to: Date }` (`fromDay`/`toDay` são dias de SP, inclusivos)
  - `DEFAULT_PERIOD = '30d'`
  - `parseMetricsFilters(sp: URLSearchParams, now: Date): MetricsFilters` (período desconhecido ou `custom` inválido/maior que 366 dias → `30d`)
  - `filtersToSearch(f: Pick<MetricsFilters,'period'|'fromDay'|'toDay'|'groupJid'>): string` (search params da página: `period`, `from`/`to` só no `custom`, `groupJid`)
  - `filtersToApiQuery(f: Pick<MetricsFilters,'from'|'to'|'groupJid'>): string` (`from`/`to` ISO + `groupJid`)
  - `useMetricsFilters(): { filters: MetricsFilters; setPeriod(p: Exclude<MetricsPeriod,'custom'>): void; setCustom(fromDay: string, toDay: string): void; setGroup(groupJid: string | null): void }` (navega com `router.push`, preservando o histórico)
  - `METRICS_STALE_TIME = 60_000`; `useMetricsOverview`, `useMetricsGroups`, `useMetricsSends`, `useMetricsProducts`, `useMetricsClicks`, `useMetricsAutomation`, todos `(filters: MetricsFilters) => UseQueryResult<T>` com `queryKey: ['metrics', painel, query]`

- [ ] **Step 1: Write the failing tests**

Crie `apps/web/test/metrics-filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filtersToApiQuery, filtersToSearch, parseMetricsFilters } from '@/lib/metrics-filters';

const NOW = new Date('2026-10-13T15:00:00Z');
const parse = (qs: string) => parseMetricsFilters(new URLSearchParams(qs), NOW);

describe('parseMetricsFilters', () => {
  it('usa 30 dias por padrão', () => {
    const f = parse('');
    expect(f.period).toBe('30d');
    expect(f.fromDay).toBe('2026-09-14');
    expect(f.toDay).toBe('2026-10-13');
    expect(f.from.toISOString()).toBe('2026-09-14T03:00:00.000Z');
    expect(f.to.toISOString()).toBe('2026-10-14T03:00:00.000Z');
    expect(f.groupJid).toBeNull();
  });

  it('lê período rápido e grupo', () => {
    const f = parse('period=7d&groupJid=g1%40g.us');
    expect(f.period).toBe('7d');
    expect(f.fromDay).toBe('2026-10-07');
    expect(f.groupJid).toBe('g1@g.us');
  });

  it('lê intervalo personalizado com fim inclusivo', () => {
    const f = parse('period=custom&from=2026-02-01&to=2026-02-28');
    expect(f.period).toBe('custom');
    expect(f.from.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    expect(f.to.toISOString()).toBe('2026-03-01T03:00:00.000Z');
  });

  it.each([
    ['period=custom&from=2026-02-10&to=2026-02-01'],
    ['period=custom&from=2026-02-30&to=2026-03-01'],
    ['period=custom&from=2025-01-01&to=2026-01-02'],
    ['period=custom'],
    ['period=xyz'],
  ])('volta para 30 dias quando inválido: %s', (qs) => {
    expect(parse(qs).period).toBe('30d');
  });
});

describe('serialização', () => {
  it('filtersToSearch omite o padrão', () => {
    expect(filtersToSearch(parse(''))).toBe('');
    expect(filtersToSearch(parse('period=7d&groupJid=g1%40g.us'))).toBe(
      'period=7d&groupJid=g1%40g.us',
    );
    expect(filtersToSearch(parse('period=custom&from=2026-02-01&to=2026-02-28'))).toBe(
      'period=custom&from=2026-02-01&to=2026-02-28',
    );
  });

  it('filtersToApiQuery manda instantes ISO', () => {
    expect(filtersToApiQuery(parse('groupJid=g1%40g.us'))).toBe(
      'from=2026-09-14T03%3A00%3A00.000Z&to=2026-10-14T03%3A00%3A00.000Z&groupJid=g1%40g.us',
    );
  });
});
```

Crie `apps/web/test/metrics-queries.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseMetricsFilters } from '@/lib/metrics-filters';
import { useMetricsSends } from '@/lib/metrics-queries';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

describe('useMetrics*', () => {
  it('chama a rota do painel com from/to/groupJid', async () => {
    apiFetchMock.mockResolvedValue({ ok: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const filters = parseMetricsFilters(
      new URLSearchParams('period=7d&groupJid=g1%40g.us'),
      new Date('2026-10-13T15:00:00Z'),
    );
    const { result } = renderHook(() => useMetricsSends(filters), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/metrics/sends?from=2026-10-07T03%3A00%3A00.000Z&to=2026-10-14T03%3A00%3A00.000Z&groupJid=g1%40g.us',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @afilados/web exec vitest run test/metrics-filters.test.ts test/metrics-queries.test.tsx`
Expected: FAIL com `Failed to resolve import "@/lib/metrics-filters"`.

- [ ] **Step 3: Write minimal implementation**

Instale o Recharts:

```bash
pnpm --filter @afilados/web add recharts@^3.2.1
```

Crie `apps/web/src/lib/metrics-filters.ts`:

```ts
import {
  METRICS_MAX_RANGE_DAYS,
  METRICS_PERIODS,
  customRange,
  periodRange,
  spAddDays,
  spDayKey,
  spDayKeysInRange,
  type MetricsPeriod,
} from '@afilados/shared';

export interface MetricsFilters {
  period: MetricsPeriod;
  /** dia de SP (YYYY-MM-DD), inclusivo */
  fromDay: string;
  /** dia de SP (YYYY-MM-DD), inclusivo */
  toDay: string;
  groupJid: string | null;
  from: Date;
  to: Date;
}

export const DEFAULT_PERIOD: MetricsPeriod = '30d';

const isDay = (d: string | null): d is string =>
  !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && spAddDays(d, 0) === d;

export function parseMetricsFilters(sp: URLSearchParams, now: Date): MetricsFilters {
  const groupJid = sp.get('groupJid') || null;
  const raw = sp.get('period') ?? '';
  const period = (METRICS_PERIODS as readonly string[]).includes(raw)
    ? (raw as MetricsPeriod)
    : DEFAULT_PERIOD;

  if (period === 'custom') {
    const fromDay = sp.get('from');
    const toDay = sp.get('to');
    if (isDay(fromDay) && isDay(toDay) && fromDay <= toDay) {
      const r = customRange(fromDay, toDay);
      if (spDayKeysInRange(r.from, r.to).length <= METRICS_MAX_RANGE_DAYS) {
        return { period, fromDay, toDay, groupJid, ...r };
      }
    }
  }

  const quick = period === 'custom' ? DEFAULT_PERIOD : period;
  const r = periodRange(quick, now);
  return {
    period: quick,
    fromDay: spDayKey(r.from),
    toDay: spDayKey(new Date(r.to.getTime() - 1)),
    groupJid,
    ...r,
  };
}

/** Search params da página (o período padrão fica implícito). */
export function filtersToSearch(
  f: Pick<MetricsFilters, 'period' | 'fromDay' | 'toDay' | 'groupJid'>,
): string {
  const sp = new URLSearchParams();
  if (f.period !== DEFAULT_PERIOD) sp.set('period', f.period);
  if (f.period === 'custom') {
    sp.set('from', f.fromDay);
    sp.set('to', f.toDay);
  }
  if (f.groupJid) sp.set('groupJid', f.groupJid);
  return sp.toString();
}

/** Query string das rotas /metrics: instantes ISO + grupo. */
export function filtersToApiQuery(f: Pick<MetricsFilters, 'from' | 'to' | 'groupJid'>): string {
  const sp = new URLSearchParams({ from: f.from.toISOString(), to: f.to.toISOString() });
  if (f.groupJid) sp.set('groupJid', f.groupJid);
  return sp.toString();
}
```

Crie `apps/web/src/lib/use-metrics-filters.ts`:

```ts
'use client';
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { MetricsPeriod } from '@afilados/shared';
import { filtersToSearch, parseMetricsFilters, type MetricsFilters } from './metrics-filters';

export function useMetricsFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = params.toString();
  const filters = useMemo(
    () => parseMetricsFilters(new URLSearchParams(search), new Date()),
    [search],
  );

  const navigate = useCallback(
    (next: Pick<MetricsFilters, 'period' | 'fromDay' | 'toDay' | 'groupJid'>) => {
      const qs = filtersToSearch(next);
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  return {
    filters,
    setPeriod: (period: Exclude<MetricsPeriod, 'custom'>) => navigate({ ...filters, period }),
    setCustom: (fromDay: string, toDay: string) =>
      navigate({ ...filters, period: 'custom', fromDay, toDay }),
    setGroup: (groupJid: string | null) => navigate({ ...filters, groupJid }),
  };
}
```

Crie `apps/web/src/lib/metrics-queries.ts`:

```ts
'use client';
import { useQuery } from '@tanstack/react-query';
import type {
  MetricsAutomation,
  MetricsClicks,
  MetricsGroups,
  MetricsOverview,
  MetricsProducts,
  MetricsSends,
} from '@afilados/shared';
import { apiFetch } from './api';
import { filtersToApiQuery, type MetricsFilters } from './metrics-filters';

export const METRICS_STALE_TIME = 60_000;

type Panel = 'overview' | 'groups' | 'sends' | 'products' | 'clicks' | 'automation';

function useMetricsPanel<T>(panel: Panel, filters: MetricsFilters) {
  const qs = filtersToApiQuery(filters);
  return useQuery({
    queryKey: ['metrics', panel, qs],
    queryFn: () => apiFetch<T>(`/metrics/${panel}?${qs}`),
    staleTime: METRICS_STALE_TIME,
  });
}

export const useMetricsOverview = (f: MetricsFilters) =>
  useMetricsPanel<MetricsOverview>('overview', f);
export const useMetricsGroups = (f: MetricsFilters) => useMetricsPanel<MetricsGroups>('groups', f);
export const useMetricsSends = (f: MetricsFilters) => useMetricsPanel<MetricsSends>('sends', f);
export const useMetricsProducts = (f: MetricsFilters) =>
  useMetricsPanel<MetricsProducts>('products', f);
export const useMetricsClicks = (f: MetricsFilters) => useMetricsPanel<MetricsClicks>('clicks', f);
export const useMetricsAutomation = (f: MetricsFilters) =>
  useMetricsPanel<MetricsAutomation>('automation', f);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @afilados/web exec vitest run test/metrics-filters.test.ts test/metrics-queries.test.tsx
pnpm --filter @afilados/web typecheck
```
Expected: 11 testes PASS (10 + 1); typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/metrics-filters.ts apps/web/src/lib/use-metrics-filters.ts apps/web/src/lib/metrics-queries.ts apps/web/test/metrics-filters.test.ts apps/web/test/metrics-queries.test.tsx
git commit -m "feat(web): filtros do dashboard na URL e hooks de métricas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Estado por seção, KPIs e barra de filtros (Trilha C, agente FrontEnd Designer)

**Files:**
- Create: `apps/web/src/lib/metrics-format.ts`
- Create: `apps/web/src/components/metrics/metrics-section.tsx`
- Create: `apps/web/src/components/metrics/kpi-cards.tsx`
- Create: `apps/web/src/components/metrics/filter-bar.tsx`
- Create: `apps/web/test/metrics-fixtures.ts`
- Test: `apps/web/test/metrics-ui.test.tsx`

**Interfaces:**
- Consumes: `MetricsFilters`, `parseMetricsFilters` (T11); tipos `Metrics*`, `MetricsGroupOption`, `MetricsPeriod`, `METRICS_TIMEZONE` (T1); `Button` (`@/components/ui/button`, variantes `default`/`outline`, tamanho `sm`), `Skeleton` (`@/components/ui/skeleton`).
- Produces:
  - `formatInt(n)`, `formatSigned(n)`, `formatPct(n)`, `formatDayLabel(day: 'YYYY-MM-DD'): 'DD/MM'`, `formatDateBR(iso): 'DD/MM/AAAA'` (fuso SP), `MARKETPLACE_LABELS: Record<string, string>`
  - `interface PanelQuery<T> { data: T | undefined; isPending: boolean; isError: boolean; refetch: () => unknown }` (um `UseQueryResult<T>` serve)
  - `<MetricsSection id title query isEmpty emptyMessage notice? children>`: esqueleto (`data-testid="{id}-skeleton"`), card de erro (`role="alert"`, botão "Tentar novamente" → `refetch`), estado vazio ou conteúdo
  - `<DeltaBadge delta invert?>` (`data-tone="good" | "bad" | "neutral"`), `<KpiCards query: PanelQuery<MetricsOverview>>` (cada KPI é `role="group"` com `aria-label` = rótulo; valor em `data-testid="kpi-{chave}"`)
  - `<FilterBar filters groupOptions onPeriod onCustom onGroup>`
  - Fixtures de teste da web: `overviewFixture`, `groupsFixture`, `sendsFixture`, `productsFixture`, `clicksFixture`, `automationFixture`

- [ ] **Step 1: Write the failing test**

Crie `apps/web/test/metrics-fixtures.ts`:

```ts
import type {
  MetricsAutomation,
  MetricsClicks,
  MetricsGroups,
  MetricsOverview,
  MetricsProducts,
  MetricsSends,
} from '@afilados/shared';

export const overviewFixture: MetricsOverview = {
  range: {
    from: '2026-10-07T03:00:00.000Z',
    to: '2026-10-14T03:00:00.000Z',
    previousFrom: '2026-09-30T03:00:00.000Z',
    previousTo: '2026-10-07T03:00:00.000Z',
  },
  trackingSince: '2026-10-01T12:00:00.000Z',
  groupOptions: [
    { jid: 'g1@g.us', name: 'Grupo 1' },
    { jid: 'g2@g.us', name: 'Grupo 2' },
  ],
  kpis: {
    members: { current: 1234, previous: 1200, changePct: 2.8 },
    joins: { current: 40, previous: 20, changePct: 100 },
    leaves: { current: 10, previous: 5, changePct: 100 },
    net: { current: 30, previous: 15, changePct: 100 },
    sends: { current: 200, previous: 100, changePct: 100 },
    successRate: { current: 95.5, previous: 90, changePct: 6.1 },
    clicks: { current: 12, previous: 0, changePct: null },
  },
};

export const groupsFixture: MetricsGroups = {
  trackingSince: '2026-10-01T12:00:00.000Z',
  totals: { members: 150, joins: 9, leaves: 5, net: 4 },
  series: [
    { date: '2026-10-12', joins: 4, leaves: 2, net: 2, cumulativeNet: 2, members: 148 },
    { date: '2026-10-13', joins: 5, leaves: 3, net: 2, cumulativeNet: 4, members: null },
  ],
  groups: [
    { jid: 'g1@g.us', name: 'Alfa', members: 100, joins: 6, leaves: 1, net: 5, growthPct: 5.3 },
    { jid: 'g2@g.us', name: 'Beta', members: 50, joins: 3, leaves: 4, net: -1, growthPct: -2 },
  ],
};

export const sendsFixture: MetricsSends = {
  totals: { total: 10, sent: 8, failed: 2, successRate: 80 },
  daily: [
    { date: '2026-10-12', sent: 5, failed: 1 },
    { date: '2026-10-13', sent: 3, failed: 1 },
  ],
  hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, sent: hour === 9 ? 8 : 0, failed: 0 })),
  heatmap: Array.from({ length: 168 }, (_, i) => ({
    weekday: Math.floor(i / 24),
    hour: i % 24,
    count: i === 3 * 24 + 23 ? 2 : 0,
  })),
  topErrors: [{ error: 'timeout', count: 2 }],
};

export const productsFixture: MetricsProducts = {
  top: [{ productId: 'p1', title: 'Fone Bluetooth', source: 'SHOPEE', image: null, sends: 5 }],
  byMarketplace: [
    { source: 'SHOPEE', sends: 5 },
    { source: 'AMAZON', sends: 2 },
  ],
};

export const clicksFixture: MetricsClicks = {
  total: 7,
  daily: [
    { date: '2026-10-12', clicks: 3 },
    { date: '2026-10-13', clicks: 4 },
  ],
  byLink: [{ groupLinkId: 'l1', slug: 'ofertas', label: 'Ofertas', clicks: 7 }],
};

export const automationFixture: MetricsAutomation = {
  mirror: { captured: 10, mirrored: 8, discarded: 1, errors: 1 },
  automation: { discovered: 20, dispatched: 5, skipped: 14, errors: 1 },
  coupons: { validated: 3, propagated: 6 },
  daily: [
    { date: '2026-10-12', mirrored: 4, dispatched: 2 },
    { date: '2026-10-13', mirrored: 4, dispatched: 3 },
  ],
};
```

Crie `apps/web/test/metrics-ui.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FilterBar } from '@/components/metrics/filter-bar';
import { KpiCards } from '@/components/metrics/kpi-cards';
import { MetricsSection } from '@/components/metrics/metrics-section';
import { parseMetricsFilters } from '@/lib/metrics-filters';
import {
  formatDateBR,
  formatDayLabel,
  formatInt,
  formatPct,
  formatSigned,
} from '@/lib/metrics-format';
import { overviewFixture } from './metrics-fixtures';

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const pending = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };

describe('formatação', () => {
  it('usa o padrão pt-BR', () => {
    expect(formatInt(1234)).toBe('1.234');
    expect(formatSigned(30)).toBe('+30');
    expect(formatSigned(-2)).toBe('-2');
    expect(formatPct(40)).toBe('40%');
    expect(formatPct(33.3)).toBe('33,3%');
    expect(formatDayLabel('2026-10-13')).toBe('13/10');
    expect(formatDateBR('2026-10-01T12:00:00.000Z')).toBe('01/10/2026');
  });
});

describe('MetricsSection', () => {
  it('mostra esqueleto enquanto carrega', () => {
    render(
      <MetricsSection id="x" title="Envios" query={pending} isEmpty={false} emptyMessage="vazio">
        <p>conteúdo</p>
      </MetricsSection>,
    );
    expect(screen.getByTestId('x-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('mostra card de erro com Tentar novamente', () => {
    const refetch = vi.fn();
    render(
      <MetricsSection
        id="x"
        title="Envios"
        query={{ data: undefined, isPending: false, isError: true, refetch }}
        isEmpty={false}
        emptyMessage="vazio"
      >
        <p>conteúdo</p>
      </MetricsSection>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar envios.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('mostra o estado vazio explicativo', () => {
    render(
      <MetricsSection id="x" title="Envios" query={ok({})} isEmpty emptyMessage="Nenhum envio no período.">
        <p>conteúdo</p>
      </MetricsSection>,
    );
    expect(screen.getByText('Nenhum envio no período.')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('mostra o conteúdo com dados', () => {
    render(
      <MetricsSection id="x" title="Envios" query={ok({})} isEmpty={false} emptyMessage="vazio">
        <p>conteúdo</p>
      </MetricsSection>,
    );
    expect(screen.getByRole('heading', { name: 'Envios' })).toBeInTheDocument();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
});

describe('KpiCards', () => {
  it('renderiza os 7 KPIs com variação', () => {
    render(<KpiCards query={ok(overviewFixture)} />);
    expect(screen.getByTestId('kpi-members')).toHaveTextContent('1.234');
    expect(screen.getByTestId('kpi-net')).toHaveTextContent('+30');
    expect(screen.getByTestId('kpi-successRate')).toHaveTextContent('95,5%');
    for (const label of [
      'Membros totais',
      'Entradas',
      'Saídas',
      'Saldo líquido',
      'Total de envios',
      'Taxa de sucesso',
      'Cliques em links',
    ]) {
      expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    }
    const joins = within(screen.getByRole('group', { name: 'Entradas' }));
    expect(joins.getByText(/\+100%/)).toHaveAttribute('data-tone', 'good');
    const leaves = within(screen.getByRole('group', { name: 'Saídas' }));
    expect(leaves.getByText(/\+100%/)).toHaveAttribute('data-tone', 'bad');
    const clicks = within(screen.getByRole('group', { name: 'Cliques em links' }));
    expect(clicks.getByText('sem base anterior')).toBeInTheDocument();
  });
});

describe('FilterBar', () => {
  const filters = parseMetricsFilters(new URLSearchParams(''), new Date('2026-10-13T15:00:00Z'));
  const setup = () => {
    const handlers = { onPeriod: vi.fn(), onCustom: vi.fn(), onGroup: vi.fn() };
    render(
      <FilterBar filters={filters} groupOptions={overviewFixture.groupOptions} {...handlers} />,
    );
    return handlers;
  };

  it('marca o período atual e troca de período', () => {
    const h = setup();
    expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    expect(h.onPeriod).toHaveBeenCalledWith('7d');
  });

  it('filtra por grupo e volta para todos', () => {
    const h = setup();
    const select = screen.getByLabelText('Grupo');
    expect(within(select).getByRole('option', { name: 'Todos os grupos' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'g1@g.us' } });
    expect(h.onGroup).toHaveBeenLastCalledWith('g1@g.us');
    fireEvent.change(select, { target: { value: '' } });
    expect(h.onGroup).toHaveBeenLastCalledWith(null);
  });

  it('aplica intervalo personalizado', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-10-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(h.onCustom).toHaveBeenCalledWith('2026-10-01', '2026-10-10');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/web exec vitest run test/metrics-ui.test.tsx`
Expected: FAIL com `Failed to resolve import "@/components/metrics/filter-bar"`.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/web/src/lib/metrics-format.ts`:

```ts
import { METRICS_TIMEZONE } from '@afilados/shared';

export const formatInt = (n: number) => n.toLocaleString('pt-BR');
export const formatSigned = (n: number) => (n > 0 ? `+${formatInt(n)}` : formatInt(n));
export const formatPct = (n: number) =>
  `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
/** `YYYY-MM-DD` → `DD/MM` */
export const formatDayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** ISO → `DD/MM/AAAA` no fuso de SP */
export const formatDateBR = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: METRICS_TIMEZONE });

export const MARKETPLACE_LABELS: Record<string, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  AWIN: 'Awin',
  ALIEXPRESS: 'AliExpress',
  MANUAL: 'Manual',
};
```

Crie `apps/web/src/components/metrics/metrics-section.tsx`:

```tsx
'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export interface PanelQuery<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export function MetricsSection<T>({
  id,
  title,
  query,
  isEmpty,
  emptyMessage,
  notice,
  children,
}: {
  id: string;
  title: string;
  query: PanelQuery<T>;
  isEmpty: boolean;
  emptyMessage: string;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      {notice}
      {query.isPending ? (
        <div data-testid={`${id}-skeleton`} aria-busy="true" className="space-y-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <span>Não foi possível carregar {title.toLowerCase()}.</span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        children
      )}
    </section>
  );
}
```

Crie `apps/web/src/components/metrics/kpi-cards.tsx`:

```tsx
'use client';
import type { MetricsDelta, MetricsOverview } from '@afilados/shared';
import { formatInt, formatPct, formatSigned } from '@/lib/metrics-format';
import { MetricsSection, type PanelQuery } from './metrics-section';

type KpiKey = keyof MetricsOverview['kpis'];

const KPIS: { key: KpiKey; label: string; format: (n: number) => string; invert?: boolean }[] = [
  { key: 'members', label: 'Membros totais', format: formatInt },
  { key: 'joins', label: 'Entradas', format: formatInt },
  { key: 'leaves', label: 'Saídas', format: formatInt, invert: true },
  { key: 'net', label: 'Saldo líquido', format: formatSigned },
  { key: 'sends', label: 'Total de envios', format: formatInt },
  { key: 'successRate', label: 'Taxa de sucesso', format: formatPct },
  { key: 'clicks', label: 'Cliques em links', format: formatInt },
];

/** Seta + sinal + cor: a cor nunca é o único indicador. `invert` = subir é ruim (ex.: saídas). */
export function DeltaBadge({ delta, invert = false }: { delta: MetricsDelta; invert?: boolean }) {
  if (delta.changePct === null) {
    return <span className="text-xs text-muted-foreground">sem base anterior</span>;
  }
  const up = delta.changePct > 0;
  const flat = delta.changePct === 0;
  const tone = flat ? 'neutral' : up !== invert ? 'good' : 'bad';
  const text = `${up ? '+' : ''}${formatPct(delta.changePct)}`;
  return (
    <span
      data-tone={tone}
      title="Variação em relação ao período anterior"
      className={
        tone === 'good'
          ? 'text-xs font-medium text-[var(--chart-1)]'
          : tone === 'bad'
            ? 'text-xs font-medium text-[var(--destructive)]'
            : 'text-xs font-medium text-muted-foreground'
      }
    >
      {up ? '▲' : flat ? '■' : '▼'} {text}
    </span>
  );
}

export function KpiCards({ query }: { query: PanelQuery<MetricsOverview> }) {
  const kpis = query.data?.kpis;
  return (
    <MetricsSection id="kpis" title="Indicadores" query={query} isEmpty={false} emptyMessage="">
      {kpis && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {KPIS.map(({ key, label, format, invert }) => (
            <div
              key={key}
              role="group"
              aria-label={label}
              className="rounded-lg border border-border bg-background/40 p-3"
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
              <p data-testid={`kpi-${key}`} className="text-2xl font-bold">
                {format(kpis[key].current)}
              </p>
              <DeltaBadge delta={kpis[key]} invert={invert ?? false} />
            </div>
          ))}
        </div>
      )}
    </MetricsSection>
  );
}
```

Crie `apps/web/src/components/metrics/filter-bar.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { MetricsGroupOption, MetricsPeriod } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import type { MetricsFilters } from '@/lib/metrics-filters';

type QuickPeriod = Exclude<MetricsPeriod, 'custom'>;

const PERIODS: { value: QuickPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

const fieldClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30';

export function FilterBar({
  filters,
  groupOptions,
  onPeriod,
  onCustom,
  onGroup,
}: {
  filters: MetricsFilters;
  groupOptions: MetricsGroupOption[];
  onPeriod: (period: QuickPeriod) => void;
  onCustom: (fromDay: string, toDay: string) => void;
  onGroup: (groupJid: string | null) => void;
}) {
  const [customOpen, setCustomOpen] = useState(filters.period === 'custom');
  const [fromDay, setFromDay] = useState(filters.fromDay);
  const [toDay, setToDay] = useState(filters.toDay);

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b border-border bg-background/95 py-3 backdrop-blur">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            size="sm"
            variant={filters.period === p.value ? 'default' : 'outline'}
            aria-pressed={filters.period === p.value}
            onClick={() => {
              setCustomOpen(false);
              onPeriod(p.value);
            }}
          >
            {p.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={filters.period === 'custom' ? 'default' : 'outline'}
          aria-pressed={filters.period === 'custom'}
          onClick={() => setCustomOpen(true)}
        >
          Personalizado
        </Button>
      </div>

      {customOpen && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (fromDay && toDay && fromDay <= toDay) onCustom(fromDay, toDay);
          }}
        >
          <input
            type="date"
            aria-label="Data inicial"
            className={fieldClass}
            value={fromDay}
            max={toDay}
            onChange={(e) => setFromDay(e.target.value)}
          />
          <input
            type="date"
            aria-label="Data final"
            className={fieldClass}
            value={toDay}
            min={fromDay}
            onChange={(e) => setToDay(e.target.value)}
          />
          <Button type="submit" size="sm">
            Aplicar
          </Button>
        </form>
      )}

      <select
        aria-label="Grupo"
        className={`${fieldClass} ml-auto min-w-48`}
        value={filters.groupJid ?? ''}
        onChange={(e) => onGroup(e.target.value || null)}
      >
        <option value="">Todos os grupos</option>
        {groupOptions.map((g) => (
          <option key={g.jid} value={g.jid}>
            {g.name}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @afilados/web exec vitest run test/metrics-ui.test.tsx
pnpm --filter @afilados/web typecheck
```
Expected: 9 testes PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/metrics-format.ts apps/web/src/components/metrics/metrics-section.tsx apps/web/src/components/metrics/kpi-cards.tsx apps/web/src/components/metrics/filter-bar.tsx apps/web/test/metrics-fixtures.ts apps/web/test/metrics-ui.test.tsx
git commit -m "feat(web): KPIs, barra de filtros e estados por seção do dashboard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Seções de Grupos e de Envios com Recharts (Trilha C, agente FrontEnd Designer)

Os gráficos usam só tokens CSS (`var(--chart-1..5)`, `var(--border)`, `var(--muted-foreground)`, `var(--popover)`), então seguem o tema claro/escuro. Cor nunca é o único indicador: toda série tem legenda/rótulo e o heatmap tem `aria-label` por célula.

**Files:**
- Modify: `apps/web/vitest.setup.ts` (stub de `ResizeObserver` para o `ResponsiveContainer` no jsdom)
- Create: `apps/web/src/components/metrics/chart-box.tsx`
- Create: `apps/web/src/components/metrics/groups-section.tsx`
- Create: `apps/web/src/components/metrics/sends-section.tsx`
- Test: `apps/web/test/metrics-groups-sends.test.tsx`

**Interfaces:**
- Consumes: `MetricsSection`, `PanelQuery`, formatadores e fixtures (T12); `MetricsGroups`, `MetricsGroupRow`, `MetricsSends` (T1); `recharts` (T11).
- Produces:
  - `CHART_COLORS`, `PALETTE`, `AXIS_PROPS`, `GRID_STROKE`, `TOOLTIP_STYLE`, `<ChartBox title height? children>` (figura com `figcaption` + `ResponsiveContainer`)
  - `<GroupsSection query: PanelQuery<MetricsGroups>>`: aviso de início da coleta, área de evolução de membros (+ saldo acumulado), barras entradas × saídas por dia, `<GroupsTable rows>` ordenável (cabeçalhos são botões, `aria-sort`)
  - `<SendsSection query: PanelQuery<MetricsSends>>`: resumo, barras empilhadas por dia, barras por hora, `<SendsHeatmap cells>` (`role="grid"`, 168 `gridcell`), lista de principais erros

- [ ] **Step 1: Write the failing test**

Crie `apps/web/test/metrics-groups-sends.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GroupsSection } from '@/components/metrics/groups-section';
import { SendsSection } from '@/components/metrics/sends-section';
import { groupsFixture, sendsFixture } from './metrics-fixtures';

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const firstColumn = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.textContent);

describe('GroupsSection', () => {
  it('avisa a data inicial da coleta', () => {
    render(<GroupsSection query={ok(groupsFixture)} />);
    expect(
      screen.getByText('Histórico de movimentação disponível a partir de 01/10/2026'),
    ).toBeInTheDocument();
    expect(screen.getByText('Evolução de membros')).toBeInTheDocument();
    expect(screen.getByText('Entradas x saídas por dia')).toBeInTheDocument();
  });

  it('tabela ordenável por coluna', () => {
    render(<GroupsSection query={ok(groupsFixture)} />);
    expect(firstColumn()).toEqual(['Alfa', 'Beta']);
    fireEvent.click(screen.getByRole('button', { name: 'Saídas' }));
    expect(firstColumn()).toEqual(['Beta', 'Alfa']);
    expect(screen.getByRole('columnheader', { name: 'Saídas' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Saídas' }));
    expect(firstColumn()).toEqual(['Alfa', 'Beta']);
  });

  it('estado vazio e coleta ainda não iniciada', () => {
    render(
      <GroupsSection
        query={ok({
          trackingSince: null,
          totals: { members: 0, joins: 0, leaves: 0, net: 0 },
          series: [],
          groups: [],
        })}
      />,
    );
    expect(
      screen.getByText('A coleta do histórico de movimentação ainda não começou.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nenhum grupo monitorado com movimentação no período/),
    ).toBeInTheDocument();
  });
});

describe('SendsSection', () => {
  it('resumo, heatmap e principais erros', () => {
    render(<SendsSection query={ok(sendsFixture)} />);
    expect(screen.getByText(/80% de sucesso/)).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(168);
    expect(screen.getByLabelText('Qua 23h: 2 envio(s)')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText('Envios por dia')).toBeInTheDocument();
    expect(screen.getByText('Envios por hora do dia')).toBeInTheDocument();
  });

  it('estado vazio', () => {
    render(
      <SendsSection
        query={ok({ ...sendsFixture, totals: { total: 0, sent: 0, failed: 0, successRate: 0 } })}
      />,
    );
    expect(screen.getByText('Nenhum envio no período.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @afilados/web exec vitest run test/metrics-groups-sends.test.tsx`
Expected: FAIL com `Failed to resolve import "@/components/metrics/groups-section"`.

- [ ] **Step 3: Write minimal implementation**

Em `apps/web/vitest.setup.ts`, acrescente ao fim:

```ts
// Recharts (ResponsiveContainer) observa o tamanho do contêiner; o jsdom não tem ResizeObserver.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
```

Crie `apps/web/src/components/metrics/chart-box.tsx`:

```tsx
'use client';
import type { ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';

/** Só tokens do tema: os gráficos acompanham o modo claro/escuro. */
export const CHART_COLORS = {
  primary: 'var(--chart-1)',
  warn: 'var(--chart-2)',
  danger: 'var(--chart-3)',
  info: 'var(--chart-4)',
  accent: 'var(--chart-5)',
};
export const PALETTE = [
  CHART_COLORS.primary,
  CHART_COLORS.info,
  CHART_COLORS.warn,
  CHART_COLORS.accent,
  CHART_COLORS.danger,
];
export const AXIS_PROPS = { stroke: 'var(--muted-foreground)', fontSize: 12 };
export const GRID_STROKE = 'var(--border)';
export const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  color: 'var(--popover-foreground)',
  borderRadius: 8,
};

export function ChartBox({
  title,
  height = 220,
  children,
}: {
  title: string;
  height?: number;
  children: ReactElement;
}) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium text-muted-foreground">{title}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
```

Crie `apps/web/src/components/metrics/groups-section.tsx`:

```tsx
'use client';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricsGroupRow, MetricsGroups } from '@afilados/shared';
import {
  formatDateBR,
  formatDayLabel,
  formatInt,
  formatPct,
  formatSigned,
} from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

type SortKey = 'name' | 'members' | 'joins' | 'leaves' | 'net' | 'growthPct';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Grupo' },
  { key: 'members', label: 'Membros' },
  { key: 'joins', label: 'Entradas' },
  { key: 'leaves', label: 'Saídas' },
  { key: 'net', label: 'Saldo' },
  { key: 'growthPct', label: 'Crescimento' },
];

export function GroupsTable({ rows }: { rows: MetricsGroupRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'net',
    dir: 'desc',
  });
  const sorted = useMemo(() => {
    const value = (r: MetricsGroupRow) => r[sort.key] ?? Number.NEGATIVE_INFINITY;
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp =
        typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv, 'pt-BR')
          : Number(av) - Number(bv);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={
                  sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className="px-2 py-2"
              >
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() =>
                    setSort((s) => ({
                      key: c.key,
                      dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc',
                    }))
                  }
                >
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.jid} className="border-t border-border">
              <td className="px-2 py-2">{r.name}</td>
              <td className="px-2 py-2">{formatInt(r.members)}</td>
              <td className="px-2 py-2">{formatInt(r.joins)}</td>
              <td className="px-2 py-2">{formatInt(r.leaves)}</td>
              <td className="px-2 py-2">{formatSigned(r.net)}</td>
              <td className="px-2 py-2">{r.growthPct === null ? '—' : formatPct(r.growthPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GroupsSection({ query }: { query: PanelQuery<MetricsGroups> }) {
  const data = query.data;
  const isEmpty =
    !!data && data.groups.length === 0 && data.totals.joins + data.totals.leaves === 0;
  const notice = data ? (
    <p
      role="note"
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      {data.trackingSince
        ? `Histórico de movimentação disponível a partir de ${formatDateBR(data.trackingSince)}`
        : 'A coleta do histórico de movimentação ainda não começou.'}
    </p>
  ) : null;

  return (
    <MetricsSection
      id="grupos"
      title="Grupos"
      query={query}
      isEmpty={isEmpty}
      emptyMessage="Nenhum grupo monitorado com movimentação no período. Só grupos em que o bot é administrador são acompanhados."
      notice={notice}
    >
      {data && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartBox title="Evolução de membros">
              <AreaChart data={data.series}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="members"
                  name="Membros (snapshot)"
                  stroke={CHART_COLORS.primary}
                  fill={CHART_COLORS.primary}
                  fillOpacity={0.15}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="cumulativeNet"
                  name="Saldo acumulado"
                  stroke={CHART_COLORS.info}
                  fill={CHART_COLORS.info}
                  fillOpacity={0.1}
                />
              </AreaChart>
            </ChartBox>
            <ChartBox title="Entradas x saídas por dia">
              <BarChart data={data.series}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Legend />
                <Bar dataKey="joins" name="Entradas" fill={CHART_COLORS.primary} />
                <Bar dataKey="leaves" name="Saídas" fill={CHART_COLORS.danger} />
              </BarChart>
            </ChartBox>
          </div>
          <GroupsTable rows={data.groups} />
        </div>
      )}
    </MetricsSection>
  );
}
```

Crie `apps/web/src/components/metrics/sends-section.tsx`:

```tsx
'use client';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsSends } from '@afilados/shared';
import { formatDayLabel, formatInt, formatPct } from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function SendsHeatmap({ cells }: { cells: MetricsSends['heatmap'] }) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium text-muted-foreground">
        Volume por dia da semana e hora
      </figcaption>
      <div
        role="grid"
        aria-label="Mapa de calor de envios"
        className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-px text-[10px]"
      >
        {WEEKDAYS.map((w, weekday) => (
          <div role="row" key={w} className="contents">
            <span role="rowheader" className="pr-1 text-muted-foreground">
              {w}
            </span>
            {cells
              .filter((c) => c.weekday === weekday)
              .map((c) => {
                const label = `${w} ${c.hour}h: ${c.count} envio(s)`;
                return (
                  <span
                    role="gridcell"
                    key={c.hour}
                    aria-label={label}
                    title={label}
                    className="aspect-square rounded-sm"
                    style={{
                      backgroundColor: 'var(--chart-1)',
                      opacity: c.count === 0 ? 0.08 : 0.2 + 0.8 * (c.count / max),
                    }}
                  />
                );
              })}
          </div>
        ))}
      </div>
    </figure>
  );
}

export function SendsSection({ query }: { query: PanelQuery<MetricsSends> }) {
  const data = query.data;
  return (
    <MetricsSection
      id="envios"
      title="Envios"
      query={query}
      isEmpty={!!data && data.totals.total === 0}
      emptyMessage="Nenhum envio no período."
    >
      {data && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {`${formatInt(data.totals.total)} envios · ${formatInt(data.totals.sent)} entregues · ${formatInt(data.totals.failed)} com falha · ${formatPct(data.totals.successRate)} de sucesso`}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartBox title="Envios por dia">
              <BarChart data={data.daily}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Legend />
                <Bar dataKey="sent" name="Entregues" stackId="s" fill={CHART_COLORS.primary} />
                <Bar dataKey="failed" name="Falhas" stackId="s" fill={CHART_COLORS.danger} />
              </BarChart>
            </ChartBox>
            <ChartBox title="Envios por hora do dia">
              <BarChart data={data.hourly}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(h) => `${h}h`} />
                <Legend />
                <Bar dataKey="sent" name="Entregues" stackId="h" fill={CHART_COLORS.primary} />
                <Bar dataKey="failed" name="Falhas" stackId="h" fill={CHART_COLORS.danger} />
              </BarChart>
            </ChartBox>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SendsHeatmap cells={data.heatmap} />
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Principais erros</p>
              {data.topErrors.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma falha no período.</p>
              ) : (
                <ol className="space-y-1 text-sm">
                  {data.topErrors.map((e) => (
                    <li
                      key={e.error}
                      className="flex items-start justify-between gap-3 rounded-md border border-border px-2 py-1"
                    >
                      <span className="break-all">{e.error}</span>
                      <span className="font-semibold">{formatInt(e.count)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </MetricsSection>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @afilados/web exec vitest run test/metrics-groups-sends.test.tsx
pnpm --filter @afilados/web typecheck
```
Expected: 5 testes PASS; typecheck limpo. Avisos do Recharts sobre largura 0 no jsdom são esperados e não falham o teste.

- [ ] **Step 5: Commit**

```bash
git add apps/web/vitest.setup.ts apps/web/src/components/metrics/chart-box.tsx apps/web/src/components/metrics/groups-section.tsx apps/web/src/components/metrics/sends-section.tsx apps/web/test/metrics-groups-sends.test.tsx
git commit -m "feat(web): seções de grupos e envios do dashboard (Recharts + heatmap)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Produtos, Cliques, Espelhamento/automações e montagem do `/dashboard` (Trilha C, agente FrontEnd Designer)

**Files:**
- Create: `apps/web/src/components/metrics/products-section.tsx`
- Create: `apps/web/src/components/metrics/clicks-section.tsx`
- Create: `apps/web/src/components/metrics/automation-section.tsx`
- Create: `apps/web/src/components/metrics/dashboard-client.tsx`
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx` (substitui o `PhasePlaceholder`)
- Modify: `apps/web/src/app/globals.css` (paleta clara)
- Test: `apps/web/test/metrics-panels.test.tsx`
- Test: `apps/web/test/dashboard-page.test.tsx`

**Interfaces:**
- Consumes: `useMetricsFilters`, `useMetrics*` (T11); `MetricsSection`, `PanelQuery`, `KpiCards`, `FilterBar`, formatadores, fixtures (T12); `ChartBox`, `CHART_COLORS`, `PALETTE`, `AXIS_PROPS`, `GRID_STROKE`, `TOOLTIP_STYLE`, `GroupsSection`, `SendsSection` (T13).
- Produces:
  - `<ProductsSection query>` (top 10 + rosca por marketplace com legenda em texto), `<ClicksSection query>` (linha diária + tabela por link), `<AutomationSection query>` (três grupos `role="group"`: "Espelhamento", "Automações", "Cupons"; valores com `data-testid="auto-…"`)
  - `<DashboardClient>` (página inteira; título "Dashboard & Métricas")
  - Página `/dashboard` com `<Suspense>` (exigido pelo `useSearchParams` no build do Next 15)
  - Tokens de tema claro em `html:not(.dark)` (o `<html>` tem hoje `class="dark"` fixo; sem a classe, o app usa a paleta clara)

- [ ] **Step 1: Write the failing tests**

Crie `apps/web/test/metrics-panels.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AutomationSection } from '@/components/metrics/automation-section';
import { ClicksSection } from '@/components/metrics/clicks-section';
import { ProductsSection } from '@/components/metrics/products-section';
import { automationFixture, clicksFixture, productsFixture } from './metrics-fixtures';

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });

describe('ProductsSection', () => {
  it('top produtos e divisão por marketplace', () => {
    render(<ProductsSection query={ok(productsFixture)} />);
    expect(screen.getByText('Fone Bluetooth')).toBeInTheDocument();
    expect(screen.getByText('Shopee: 5')).toBeInTheDocument();
    expect(screen.getByText('Amazon: 2')).toBeInTheDocument();
  });
  it('estado vazio', () => {
    render(<ProductsSection query={ok({ top: [], byMarketplace: [] })} />);
    expect(screen.getByText('Nenhum produto enviado no período.')).toBeInTheDocument();
  });
});

describe('ClicksSection', () => {
  it('total e detalhamento por link', () => {
    render(<ClicksSection query={ok(clicksFixture)} />);
    expect(screen.getByText('7 cliques no período')).toBeInTheDocument();
    expect(screen.getByText('/g/ofertas')).toBeInTheDocument();
    expect(screen.getByText('Ofertas')).toBeInTheDocument();
  });
  it('estado vazio', () => {
    render(<ClicksSection query={ok({ total: 0, daily: [], byLink: [] })} />);
    expect(screen.getByText('Nenhum clique nos links de grupos no período.')).toBeInTheDocument();
  });
});

describe('AutomationSection', () => {
  it('resumo de espelhamento, automações e cupons', () => {
    render(<AutomationSection query={ok(automationFixture)} />);
    expect(
      within(screen.getByRole('group', { name: 'Espelhamento' })).getByTestId('auto-mirrored'),
    ).toHaveTextContent('8');
    expect(
      within(screen.getByRole('group', { name: 'Automações' })).getByTestId('auto-dispatched'),
    ).toHaveTextContent('5');
    expect(
      within(screen.getByRole('group', { name: 'Cupons' })).getByTestId('auto-propagated'),
    ).toHaveTextContent('6');
  });
  it('estado vazio', () => {
    render(
      <AutomationSection
        query={ok({
          mirror: { captured: 0, mirrored: 0, discarded: 0, errors: 0 },
          automation: { discovered: 0, dispatched: 0, skipped: 0, errors: 0 },
          coupons: { validated: 0, propagated: 0 },
          daily: [],
        })}
      />,
    );
    expect(
      screen.getByText('Nenhuma atividade de espelhamento, automação ou cupons no período.'),
    ).toBeInTheDocument();
  });
});
```

Crie `apps/web/test/dashboard-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardClient } from '@/components/metrics/dashboard-client';
import {
  automationFixture,
  clicksFixture,
  groupsFixture,
  overviewFixture,
  sendsFixture,
} from './metrics-fixtures';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams('period=7d'),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '@/lib/api';
const apiFetchMock = vi.mocked(apiFetch);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardClient />
    </QueryClientProvider>,
  );
}

describe('DashboardClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/metrics/overview')) return overviewFixture;
      if (path.startsWith('/metrics/groups')) return groupsFixture;
      if (path.startsWith('/metrics/sends')) return sendsFixture;
      if (path.startsWith('/metrics/products')) throw new Error('falhou');
      if (path.startsWith('/metrics/clicks')) return clicksFixture;
      if (path.startsWith('/metrics/automation')) return automationFixture;
      throw new Error(`rota inesperada ${path}`);
    });
  });

  it('renderiza todas as seções e isola o erro de uma delas', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Dashboard & Métricas' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('kpi-joins')).toHaveTextContent('40'));
    for (const title of ['Grupos', 'Envios', 'Produtos', 'Cliques', 'Espelhamento e automações']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar produtos.');
    expect(await screen.findByText('7 cliques no período')).toBeInTheDocument();

    const productCalls = () =>
      apiFetchMock.mock.calls.filter(([p]) => String(p).startsWith('/metrics/products')).length;
    const before = productCalls();
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(productCalls()).toBe(before + 1));
  });

  it('chama a api com o período da URL', async () => {
    renderPage();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const overviewCall = apiFetchMock.mock.calls.find(([p]) =>
      String(p).startsWith('/metrics/overview?'),
    );
    expect(String(overviewCall?.[0])).toMatch(/from=.*&to=/);
  });

  it('troca período e grupo pela URL', async () => {
    renderPage();
    await screen.findByRole('option', { name: 'Grupo 1' });
    fireEvent.click(screen.getByRole('button', { name: '30 dias' }));
    expect(push).toHaveBeenLastCalledWith('/dashboard', { scroll: false });
    fireEvent.change(screen.getByLabelText('Grupo'), { target: { value: 'g1@g.us' } });
    expect(push).toHaveBeenLastCalledWith('/dashboard?period=7d&groupJid=g1%40g.us', {
      scroll: false,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @afilados/web exec vitest run test/metrics-panels.test.tsx test/dashboard-page.test.tsx`
Expected: FAIL com `Failed to resolve import "@/components/metrics/automation-section"` e `"@/components/metrics/dashboard-client"`.

- [ ] **Step 3: Write minimal implementation**

Crie `apps/web/src/components/metrics/products-section.tsx`:

```tsx
'use client';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import type { MetricsProducts } from '@afilados/shared';
import { MARKETPLACE_LABELS, formatInt } from '@/lib/metrics-format';
import { ChartBox, PALETTE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

const label = (source: string) => MARKETPLACE_LABELS[source] ?? source;

export function ProductsSection({ query }: { query: PanelQuery<MetricsProducts> }) {
  const data = query.data;
  const slices = (data?.byMarketplace ?? []).map((m) => ({ name: label(m.source), value: m.sends }));
  return (
    <MetricsSection
      id="produtos"
      title="Produtos"
      query={query}
      isEmpty={!!data && data.top.length === 0}
      emptyMessage="Nenhum produto enviado no período."
    >
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Top 10 mais enviados</p>
            <ol className="space-y-1 text-sm">
              {data.top.map((p, i) => (
                <li
                  key={p.productId}
                  className="flex items-center gap-3 rounded-md border border-border px-2 py-1"
                >
                  <span className="w-5 text-right text-muted-foreground">{i + 1}.</span>
                  {p.image ? (
                    <img src={p.image} alt="" className="size-8 rounded object-cover" />
                  ) : (
                    <span className="size-8 rounded bg-muted" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate" title={p.title}>
                    {p.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{label(p.source)}</span>
                  <span className="font-semibold">{formatInt(p.sends)}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2">
            <ChartBox title="Envios por marketplace">
              <PieChart>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                  {slices.map((s, i) => (
                    <Cell key={s.name} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ChartBox>
            <ul className="flex flex-wrap gap-3 text-xs">
              {slices.map((s, i) => (
                <li key={s.name} className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                  />
                  {`${s.name}: ${formatInt(s.value)}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </MetricsSection>
  );
}
```

Crie `apps/web/src/components/metrics/clicks-section.tsx`:

```tsx
'use client';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsClicks } from '@afilados/shared';
import { formatDayLabel, formatInt } from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

export function ClicksSection({ query }: { query: PanelQuery<MetricsClicks> }) {
  const data = query.data;
  return (
    <MetricsSection
      id="cliques"
      title="Cliques"
      query={query}
      isEmpty={!!data && data.total === 0}
      emptyMessage="Nenhum clique nos links de grupos no período."
    >
      {data && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{`${formatInt(data.total)} cliques no período`}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartBox title="Cliques por dia">
              <LineChart data={data.daily}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(d) => formatDayLabel(String(d))}
                />
                <Line
                  type="monotone"
                  dataKey="clicks"
                  name="Cliques"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartBox>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-2 py-2">
                      Link
                    </th>
                    <th scope="col" className="px-2 py-2">
                      Endereço
                    </th>
                    <th scope="col" className="px-2 py-2 text-right">
                      Cliques
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byLink.map((l) => (
                    <tr key={l.groupLinkId} className="border-t border-border">
                      <td className="px-2 py-2">{l.label}</td>
                      <td className="px-2 py-2 text-muted-foreground">{`/g/${l.slug}`}</td>
                      <td className="px-2 py-2 text-right font-semibold">{formatInt(l.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </MetricsSection>
  );
}
```

Crie `apps/web/src/components/metrics/automation-section.tsx`:

```tsx
'use client';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsAutomation } from '@afilados/shared';
import { formatDayLabel, formatInt } from '@/lib/metrics-format';
import { AXIS_PROPS, CHART_COLORS, ChartBox, GRID_STROKE, TOOLTIP_STYLE } from './chart-box';
import { MetricsSection, type PanelQuery } from './metrics-section';

function StatGroup({
  title,
  stats,
}: {
  title: string;
  stats: { label: string; value: number; testId: string }[];
}) {
  return (
    <div role="group" aria-label={title} className="rounded-lg border border-border p-3">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <dl className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.testId}>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd data-testid={s.testId} className="text-xl font-bold">
              {formatInt(s.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AutomationSection({ query }: { query: PanelQuery<MetricsAutomation> }) {
  const data = query.data;
  const isEmpty =
    !!data &&
    [
      ...Object.values(data.mirror),
      ...Object.values(data.automation),
      ...Object.values(data.coupons),
    ].every((n) => n === 0);
  return (
    <MetricsSection
      id="automacoes"
      title="Espelhamento e automações"
      query={query}
      isEmpty={isEmpty}
      emptyMessage="Nenhuma atividade de espelhamento, automação ou cupons no período."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <StatGroup
              title="Espelhamento"
              stats={[
                { label: 'Capturadas', value: data.mirror.captured, testId: 'auto-captured' },
                { label: 'Espelhadas', value: data.mirror.mirrored, testId: 'auto-mirrored' },
                { label: 'Descartadas', value: data.mirror.discarded, testId: 'auto-discarded' },
                { label: 'Erros', value: data.mirror.errors, testId: 'auto-mirror-errors' },
              ]}
            />
            <StatGroup
              title="Automações"
              stats={[
                {
                  label: 'Descobertas',
                  value: data.automation.discovered,
                  testId: 'auto-discovered',
                },
                {
                  label: 'Disparadas',
                  value: data.automation.dispatched,
                  testId: 'auto-dispatched',
                },
                { label: 'Ignoradas', value: data.automation.skipped, testId: 'auto-skipped' },
                { label: 'Erros', value: data.automation.errors, testId: 'auto-errors' },
              ]}
            />
            <StatGroup
              title="Cupons"
              stats={[
                { label: 'Validados', value: data.coupons.validated, testId: 'auto-validated' },
                { label: 'Propagados', value: data.coupons.propagated, testId: 'auto-propagated' },
              ]}
            />
          </div>
          <ChartBox title="Espelhadas e disparadas por dia">
            <BarChart data={data.daily}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={formatDayLabel} {...AXIS_PROPS} />
              <YAxis allowDecimals={false} {...AXIS_PROPS} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(d) => formatDayLabel(String(d))}
              />
              <Legend />
              <Bar dataKey="mirrored" name="Espelhadas" fill={CHART_COLORS.info} />
              <Bar dataKey="dispatched" name="Disparadas pela automação" fill={CHART_COLORS.warn} />
            </BarChart>
          </ChartBox>
        </div>
      )}
    </MetricsSection>
  );
}
```

Crie `apps/web/src/components/metrics/dashboard-client.tsx`:

```tsx
'use client';
import { useMetricsFilters } from '@/lib/use-metrics-filters';
import {
  useMetricsAutomation,
  useMetricsClicks,
  useMetricsGroups,
  useMetricsOverview,
  useMetricsProducts,
  useMetricsSends,
} from '@/lib/metrics-queries';
import { AutomationSection } from './automation-section';
import { ClicksSection } from './clicks-section';
import { FilterBar } from './filter-bar';
import { GroupsSection } from './groups-section';
import { KpiCards } from './kpi-cards';
import { ProductsSection } from './products-section';
import { SendsSection } from './sends-section';

export function DashboardClient() {
  const { filters, setPeriod, setCustom, setGroup } = useMetricsFilters();
  const overview = useMetricsOverview(filters);
  const groups = useMetricsGroups(filters);
  const sends = useMetricsSends(filters);
  const products = useMetricsProducts(filters);
  const clicks = useMetricsClicks(filters);
  const automation = useMetricsAutomation(filters);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dashboard & Métricas</h1>
        <p className="text-sm text-muted-foreground">
          Variações comparadas ao período anterior de mesmo tamanho. Datas no fuso de São Paulo.
        </p>
      </header>
      <FilterBar
        key={`${filters.period}:${filters.fromDay}:${filters.toDay}`}
        filters={filters}
        groupOptions={overview.data?.groupOptions ?? []}
        onPeriod={setPeriod}
        onCustom={setCustom}
        onGroup={setGroup}
      />
      <KpiCards query={overview} />
      <GroupsSection query={groups} />
      <SendsSection query={sends} />
      <ProductsSection query={products} />
      <ClicksSection query={clicks} />
      <AutomationSection query={automation} />
    </div>
  );
}
```

Substitua o conteúdo de `apps/web/src/app/(app)/dashboard/page.tsx` por:

```tsx
import { Suspense } from 'react';
import { DashboardClient } from '@/components/metrics/dashboard-client';

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
      <DashboardClient />
    </Suspense>
  );
}
```

Em `apps/web/src/app/globals.css`, logo após o bloco `:root { ... }` (antes de `@layer base`), acrescente:

```css
/* Paleta clara: vale quando o <html> não tem a classe `dark` (hoje fixa no layout). */
html:not(.dark) {
  --background: hsl(210 40% 98%);
  --foreground: hsl(222 47% 11%);
  --surface: hsl(0 0% 100%);
  --surface-2: hsl(210 40% 96%);
  --secondary: hsl(210 40% 94%);
  --muted: hsl(210 40% 94%);
  --muted-foreground: hsl(215 19% 35%);
  --accent: hsl(210 40% 92%);
  --border: hsl(214 32% 85%);
  --input: hsl(214 32% 80%);
  --chart-1: hsl(173 80% 28%);
  --chart-2: hsl(32 95% 40%);
  --chart-3: hsl(0 72% 45%);
  --chart-4: hsl(217 80% 45%);
  --chart-5: hsl(280 60% 45%);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @afilados/web exec vitest run test/metrics-panels.test.tsx test/dashboard-page.test.tsx
pnpm --filter @afilados/web test
pnpm --filter @afilados/web typecheck
```
Expected: 9 testes PASS (6 + 3); a suíte inteira da web continua PASS; typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/metrics/products-section.tsx apps/web/src/components/metrics/clicks-section.tsx apps/web/src/components/metrics/automation-section.tsx apps/web/src/components/metrics/dashboard-client.tsx "apps/web/src/app/(app)/dashboard/page.tsx" apps/web/src/app/globals.css apps/web/test/metrics-panels.test.tsx apps/web/test/dashboard-page.test.tsx
git commit -m "feat(web): dashboard de métricas completo em /dashboard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Seed de métricas e E2E Playwright do dashboard (Trilha C, agente FrontEnd Designer)

O E2E só roda contra o stack completo (web + api + banco com a migration de T2). Ele é escrito e listado aqui e executado em T17, no Docker.

**Files:**
- Modify: `apps/web/e2e/seed.ts` (dados de métricas do tenant `e2e`)
- Create: `apps/web/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: modelos de T2; `spDayKey`, `spMidnight` (T1); `/dashboard` (T14) com `data-testid="kpi-joins"`/`"kpi-leaves"` e `<select aria-label="Grupo">` (T12).
- Produces: seed idempotente com, no grupo `e2e@g.us`, 3 entradas (`JOIN` há 2 h e 26 h, `ADDED` há 50 h), 1 saída (`LEAVE` há 3 h), 1 snapshot de hoje, 3 envios `SENT` e 1 `ERROR`; spec `apps/web/e2e/dashboard.spec.ts`.

- [ ] **Step 1: Write the E2E spec**

Crie `apps/web/e2e/dashboard.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill('e2e@test.local');
  await page.getByLabel('Senha').fill('e2e-senha-123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible({ timeout: 30_000 });
}

test('dashboard: abre, troca período e filtra por grupo', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard & Métricas' })).toBeVisible();
  await expect(page.getByTestId('kpi-joins')).toHaveText('3', { timeout: 15_000 });
  await expect(page.getByTestId('kpi-leaves')).toHaveText('1');
  await expect(
    page.getByText(/Histórico de movimentação disponível a partir de \d{2}\/\d{2}\/\d{4}/),
  ).toBeVisible();
  for (const title of ['Grupos', 'Envios', 'Produtos', 'Cliques', 'Espelhamento e automações']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }

  await page.getByRole('button', { name: '7 dias' }).click();
  await expect(page).toHaveURL(/period=7d/);
  await expect(page.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kpi-joins')).toHaveText('3');

  await page.getByLabel('Grupo').selectOption({ label: 'Grupo E2E Destino' });
  await expect(page).toHaveURL(/groupJid=e2e-dest%40g\.us/);
  await expect(page.getByTestId('kpi-joins')).toHaveText('0');

  await page.goBack();
  await expect(page).not.toHaveURL(/groupJid=/);
  await expect(page.getByTestId('kpi-joins')).toHaveText('3');
});

test('dashboard no modo claro', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByTestId('kpi-joins')).toHaveText('3', { timeout: 15_000 });
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await background();
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  expect(await background()).not.toBe(dark);
  await expect(page.getByTestId('kpi-joins')).toBeVisible();
  await page.screenshot({ path: 'test-results/dashboard-claro.png', fullPage: true });
});
```

- [ ] **Step 2: Confirm the spec is picked up**

Run: `pnpm --filter @afilados/web exec playwright test --list e2e/dashboard.spec.ts`
Expected: lista 2 testes (`dashboard: abre, troca período e filtra por grupo` e `dashboard no modo claro`). A execução real fica para T17: sem o seed de métricas, o primeiro teste falharia em `kpi-joins` com `0`.

- [ ] **Step 3: Add the metrics seed**

Em `apps/web/e2e/seed.ts`:
1. Troque `import { prisma, encryptJson } from '@afilados/db';` por:
   ```ts
   import { prisma, encryptJson } from '@afilados/db';
   import { spDayKey, spMidnight } from '@afilados/shared';
   ```
2. Logo após `await prisma.mirrorRule.deleteMany({ where: { tenantId: tenant.id } });`, acrescente:
   ```ts
   // métricas do dashboard: recria a cada execução
   await prisma.groupMemberEvent.deleteMany({ where: { tenantId: tenant.id } });
   await prisma.groupSnapshot.deleteMany({ where: { tenantId: tenant.id } });
   await prisma.sendLog.deleteMany({ where: { tenantId: tenant.id } });
   const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
   const moves: { action: 'JOIN' | 'ADDED' | 'LEAVE'; h: number; who: string }[] = [
     { action: 'JOIN', h: 2, who: 'e2e-a' },
     { action: 'JOIN', h: 26, who: 'e2e-b' },
     { action: 'ADDED', h: 50, who: 'e2e-c' },
     { action: 'LEAVE', h: 3, who: 'e2e-d' },
   ];
   await prisma.groupMemberEvent.createMany({
     data: moves.map((m) => ({
       tenantId: tenant.id,
       sessionId: session.id,
       groupJid: 'e2e@g.us',
       participantJid: `${m.who}@s.whatsapp.net`,
       action: m.action,
       occurredAt: hoursAgo(m.h),
       dedupeKey: `e2e-seed-${m.who}`,
     })),
   });
   await prisma.groupSnapshot.create({
     data: {
       tenantId: tenant.id,
       sessionId: session.id,
       groupJid: 'e2e@g.us',
       date: spMidnight(spDayKey(new Date())),
       memberCount: 3,
     },
   });
   await prisma.sendLog.createMany({
     data: [1, 2, 3, 4].map((h) => ({
       tenantId: tenant.id,
       groupJid: 'e2e@g.us',
       status: h === 4 ? ('ERROR' as const) : ('SENT' as const),
       error: h === 4 ? 'timeout' : null,
       sentAt: hoursAgo(h),
     })),
   });
   ```

- [ ] **Step 4: Typecheck the seed and the spec**

Run: `pnpm --filter @afilados/web exec tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --strict --types node e2e/seed.ts e2e/dashboard.spec.ts`
Expected: nenhuma saída. O diretório `e2e` fica fora do `tsconfig.json` da web, por isso o `tsc` direto nos dois arquivos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/seed.ts apps/web/e2e/dashboard.spec.ts
git commit -m "test(web): seed de métricas e E2E do dashboard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Integração das trilhas, verificação completa e PR (Trilha D, agente Github)

**Files:** nenhum arquivo de produção; só merges, verificação e PR.

**Interfaces:**
- Consumes: branches `feat/dashboard-metricas-a` (T2–T5), `feat/dashboard-metricas-b` (T1, T6–T10, já com T2 mesclado), `feat/dashboard-metricas-c` (T11–T15).
- Produces: branch `feat/dashboard-metricas` no `origin` com tudo integrado e PR aberto para `main`.

A árvore principal (`D:\apps\afilados`) está em `feat/dashboard-metricas` com alterações alheias: não faça checkout, stash nem reset nela. Integre numa worktree própria.

- [ ] **Step 1: Criar a worktree de integração e mesclar as trilhas**

```bash
git worktree add ../afilados-metricas-int -b feat/dashboard-metricas-int feat/dashboard-metricas
cd ../afilados-metricas-int
git merge --no-ff feat/dashboard-metricas-b -m "merge: trilha B (serviço e rotas de métricas)"
git merge --no-ff feat/dashboard-metricas-a -m "merge: trilha A (eventos, snapshots e cliques)"
git merge --no-ff feat/dashboard-metricas-c -m "merge: trilha C (interface do dashboard)"
pnpm install
mkdir -p .superpowers/sdd && cp ../afilados/.superpowers/sdd/remote.sh .superpowers/sdd/
```
Expected: merges sem conflito (as trilhas tocam arquivos disjuntos; `packages/shared/src/index.ts` só muda em T1). Se houver conflito em `apps/worker/src/main.ts` ou `packages/shared/src/queues.ts`, mantenha as linhas acrescentadas dos dois lados.

- [ ] **Step 2: Verificação completa**

```bash
pnpm db:generate
pnpm typecheck
pnpm --filter @afilados/shared test
pnpm --filter @afilados/web test
.superpowers/sdd/remote.sh setup
.superpowers/sdd/remote.sh run pnpm test
```
Expected: typecheck limpo em todos os pacotes; suítes de `shared` e `web` PASS localmente; `pnpm test` no servidor (todas as suítes, incluindo api, worker e db) PASS. Qualquer falha volta para a trilha dona do arquivo, com a saída do teste.

- [ ] **Step 3: Formatação**

```bash
git diff --name-only feat/dashboard-metricas...HEAD | grep -E '\.(ts|tsx|css|json)$' | xargs pnpm exec prettier --check
```
Expected: `All matched files use Prettier code style!`. Se não, rode o mesmo comando com `--write` no lugar de `--check` e faça commit `style: prettier nos arquivos do dashboard de métricas`.

- [ ] **Step 4: Publicar e abrir o PR**

```bash
git push origin feat/dashboard-metricas-int:feat/dashboard-metricas
gh pr create --base main --head feat/dashboard-metricas --title "feat: dashboard e métricas" --body-file - <<'EOF'
## Resumo
- Tabelas `GroupMemberEvent`, `GroupSnapshot` e `LinkClickEvent` (migration `20261013120000_metrics_events`), com retenção de 12 meses.
- Worker grava entradas e saídas dos grupos em que o bot é admin, tira snapshot diário (job BullMQ à meia-noite de SP) e no `syncGroups`.
- `/g/[slug]` passa a registrar cliques (e `GroupLink.clickCount` passa a ser incrementado).
- Rotas `GET /api/v1/metrics/{overview,groups,sends,products,clicks,automation}` com validação de período (≤ 366 dias) e de grupo do tenant.
- `/dashboard` com filtros na URL, KPIs com variação, seções por painel (Recharts), estados de carregamento, erro e vazio, tema claro/escuro.

Spec: `docs/superpowers/specs/2026-10-13-dashboard-metricas-design.md`
Plano: `docs/superpowers/plans/2026-10-13-dashboard-metricas.md`

## Testes
- `pnpm typecheck`
- `pnpm test` (servidor Linux, Postgres + Redis)
- Validação no Docker e E2E: Task 17 do plano (resultado nos comentários deste PR)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```
Expected: o push cria/atualiza `feat/dashboard-metricas` no `origin` e o `gh` imprime a URL do PR. Sem o `gh` instalado, abra `https://github.com/marqprochat/afiliado/compare/main...feat/dashboard-metricas?expand=1` e use o mesmo título e corpo.

- [ ] **Step 5: Revisão de código**

Invoque `superpowers:requesting-code-review` sobre `main...feat/dashboard-metricas` e trate os achados com `superpowers:receiving-code-review`. Correções viram commits na worktree de integração, publicados com `git push origin feat/dashboard-metricas-int:feat/dashboard-metricas`. O merge só acontece em T17, depois do Docker.

---

### Task 17: Validação no Docker, E2E e merge (Trilha D, agente Github)

**Files:** nenhum (só verificação e merge).

**Interfaces:**
- Consumes: worktree `../afilados-metricas-int` e o PR (T16).
- Produces: evidência de funcionamento no Docker, E2E verde e PR mesclado em `main`.

- [ ] **Step 1: Subir o stack no Docker**

```bash
cd ../afilados-metricas-int
cp ../afilados/.env .env
docker compose up -d --build --wait
```
Expected: `postgres`, `redis`, `api` (3011), `worker` (3012) e `web` (3010) saudáveis; o `api` aplica `20261013120000_metrics_events` no `migrate deploy`. O `.env` copiado é local e git-ignored: nunca faça commit dele.

- [ ] **Step 2: Conferir banco, agendamento e worker**

```bash
docker compose exec -T postgres psql -U afilados -d afilados -c 'SELECT count(*) FROM "GroupMemberEvent";' -c 'SELECT count(*) FROM "GroupSnapshot";' -c 'SELECT count(*) FROM "LinkClickEvent";'
docker compose exec -T redis redis-cli --scan --pattern 'bull:metrics-daily:*'
docker compose logs worker --since 10m | grep -iE 'metrics-daily|group-member-recorder|erro' || true
```
Expected: as três consultas respondem (as tabelas existem); o Redis lista chaves `bull:metrics-daily:…`, incluindo a do agendador (`repeat`); nenhum erro do recorder ou do job no log. Com sessão do WhatsApp conectada, `GroupSnapshot` já tem linhas do `syncGroups`.

- [ ] **Step 3: Rodar o E2E contra o Docker**

```bash
DATABASE_URL=postgresql://afilados:afilados@localhost:5434/afilados pnpm --filter @afilados/web e2e:seed
E2E_BASE_URL=http://localhost:3010 E2E_NO_SERVER=1 pnpm --filter @afilados/web exec playwright test e2e/dashboard.spec.ts
```
Expected: 2 testes PASS; `apps/web/test-results/dashboard-claro.png` gerado (anexe ao PR).

- [ ] **Step 4: Validação manual no navegador (http://localhost:3010/dashboard)**

1. Filtros: `Hoje`, `7 dias`, `30 dias`, `90 dias` e `Personalizado` mudam a URL (`period`, `from`, `to`); voltar no navegador restaura o filtro anterior; o seletor de grupo grava `groupJid`.
2. Cada seção mostra esqueleto ao carregar. Com a api parada (`docker compose stop api`), cada seção mostra o próprio card de erro com "Tentar novamente" e as demais não quebram; `docker compose start api` + "Tentar novamente" recupera.
3. Aviso "Histórico de movimentação disponível a partir de DD/MM/AAAA" na seção Grupos.
4. Clique real: abra `http://localhost:3010/g/<slug de um link de grupo ativo>`, volte ao dashboard e confira +1 em "Cliques em links" (e uma linha nova em `LinkClickEvent`). Sem link ativo cadastrado, reporte que não foi possível.
5. Entrada/saída real num grupo em que o bot é admin (depende de sessão do WhatsApp conectada pelo usuário): conferir uma linha nova em `GroupMemberEvent` e +1 em Entradas/Saídas. Sem sessão conectada, reporte isso explicitamente em vez de dar como validado.

- [ ] **Step 5: Comentar no PR e mesclar**

Registre no PR o resultado dos Steps 1–4 (com o screenshot). Com a revisão aprovada (T16 Step 5) e tudo verde:

```bash
gh pr merge feat/dashboard-metricas --merge
```
Expected: PR mesclado em `main`. Depois, remova as worktrees das trilhas (`git worktree remove ../afilados-metricas-a`, `-b`, `-c` e `-int`) **somente** depois de confirmar que tudo está no `origin`. Não toque na árvore principal `D:\apps\afilados`.

---

## Self-review

**Cobertura da spec:**

| Requisito da spec | Tarefa |
| --- | --- |
| `GroupMemberEvent` (campos, enum, índices, idempotência) | T2, T3 |
| `GroupSnapshot` (data truncada em SP, unique, índices) | T2, T4 |
| `LinkClickEvent` (FK em cascata, índices) gravado no redirecionamento `/g/[slug]` | T2, T5 |
| Retenção de 12 meses configurável | T4 (`METRICS_RETENTION_DAYS`, `purgeOldMetrics`) |
| Handler `group-participants.update` protegido por `try/catch` | T3 |
| Job BullMQ diário à meia-noite de SP + snapshot no `syncGroups` | T4 |
| Só grupos com `botIsAdmin = true` | T3, T4, T6 (`adminGroupsOf`) |
| `from`/`to` obrigatórios, ≤ 366 dias; `groupJid` de outro tenant → 404 | T1, T6, T10 |
| Uma função por painel, fuso SP, filtro por `tenantId` | T6–T9 |
| `overview` com comparação ao período anterior | T9 |
| `groups` (totais, série com saldo acumulado, tabela/ranking) | T8 |
| `sends` (totais, taxa, por dia, por hora, heatmap, principais erros) | T6 |
| `products` (top 10, por marketplace) | T7 |
| `clicks` (total, série diária, por link) | T8 |
| `automation` (MirrorLog, AutomationLog, cupons validados/propagados) | T7 |
| Filtros na URL, padrão 30 dias, seletor de grupo | T11, T12 |
| TanStack Query com `staleTime: 60000` | T11 |
| KPIs com badge de variação | T12 |
| Seções Grupos/Envios/Produtos/Cliques/Espelhamento com Recharts | T13, T14 |
| Esqueleto, erro com "Tentar novamente" e vazio por seção; aviso de início da coleta | T12, T13, T14 |
| Tema claro/escuro e paleta acessível | T13 (só tokens), T14 (`html:not(.dark)`), T15 (E2E no modo claro) |
| Testes com banco real (vários períodos, virada de mês/ano, fuso, multi-tenant, vazio) | T6–T10 |
| Testes do handler por ação + idempotência | T3 |
| Testes de componentes + E2E (abrir, trocar período, filtrar grupo) | T11–T15 |
| Validação no Docker antes de concluir; PR, revisão e merge | T16, T17 |

**Decisões tomadas onde a spec deixou em aberto:**
- `JOIN`×`ADDED` e `LEAVE`×`REMOVED` são distinguidos pelo `author` do evento do Baileys (ausente ou igual ao participante = ação do próprio membro).
- Idempotência por `dedupeKey` único com granularidade de minuto, porque o evento do Baileys não traz carimbo de tempo próprio.
- "Membros" do período anterior = membros atuais − saldo do período (não depende de snapshot antigo, que não existe antes do deploy).
- `GroupLink.clickCount` nunca era incrementado; passa a ser, junto com o `LinkClickEvent`.
- Cupons "validados" = `CouponCheck` com resultado `VALID`; "propagados" = envios `SENT` de itens de lote com cupom.
- O `AutomationLog` não tem grupo; o filtro `groupJid` não se aplica a ele.

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-10-13-dashboard-metricas.md`. Execução por trilhas no Maestri:

1. **Programador** (Trilha B) faz T1 e avisa as trilhas A e C.
2. Em paralelo: **Prisma** (Trilha A: T2→T5), **Programador** (T6→T7, depois T8→T10 com T2 mesclado) e **FrontEnd Designer** (Trilha C: T11→T15).
3. **Github** (Trilha D: T16→T17) integra, valida no Docker e mescla.

Cada agente usa `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` nas suas tarefas.
