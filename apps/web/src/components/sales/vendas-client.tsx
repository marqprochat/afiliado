'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, RefreshCw } from 'lucide-react';
import type { AffiliateSaleStatus, SalesSummary } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { MetricsSection } from '@/components/metrics/metrics-section';
import { formatBRL, formatDateTime } from '@/lib/format';
import { formatDayLabel, formatInt, formatPct } from '@/lib/metrics-format';
import { copyToClipboard } from '@/lib/clipboard';
import {
  lastDaysRange,
  useAwinWebhook,
  useRotateAwinWebhook,
  useSalesList,
  useSalesSummary,
  type SalesRange,
} from '@/lib/sales-queries';

const PERIODS = [7, 30, 90] as const;

const STATUS_LABELS: Record<AffiliateSaleStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  DECLINED: 'Recusada',
  DELETED: 'Excluída',
};
const STATUS_CLASS: Record<AffiliateSaleStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-500',
  APPROVED: 'bg-emerald-500/15 text-emerald-500',
  DECLINED: 'bg-destructive/15 text-destructive',
  DELETED: 'bg-muted text-muted-foreground',
};

/** BRL formatado; outras moedas como vieram (valor + código). */
export function formatMoney(n: number, currency = 'BRL'): string {
  if (currency === 'BRL') return formatBRL(n);
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const conversionText = (c: number | null) => (c === null ? '—' : formatPct(c * 100));

const th = 'px-2 py-2 font-medium';
const td = 'px-2 py-2';

function Cards({ data, currency }: { data: SalesSummary; currency: string }) {
  const t = data.totals;
  const cards = [
    { label: 'Comissão aprovada', value: formatMoney(t.commissionApproved, currency) },
    { label: 'Comissão pendente', value: formatMoney(t.commissionPending, currency) },
    { label: 'Vendas', value: formatInt(t.sales) },
    { label: 'Cliques', value: formatInt(t.clicks) },
    { label: 'Conversão', value: conversionText(t.conversion) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => (
        <div
          key={c.label}
          role="group"
          aria-label={c.label}
          className="rounded-lg border border-border bg-background/40 p-3"
        >
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
          <p className="truncate text-xl font-bold sm:text-2xl">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function DailyBars({ data, currency }: { data: SalesSummary['daily']; currency: string }) {
  const max = Math.max(0, ...data.map((d) => d.commission));
  if (data.length === 0) return null;
  return (
    <div>
      <div className="flex h-32 items-end gap-px" aria-hidden="true">
        {data.map((d) => (
          <div
            key={d.date}
            title={`${formatDayLabel(d.date)}: ${formatMoney(d.commission, currency)} (${d.sales} vendas)`}
            className="flex-1 rounded-t bg-[var(--chart-1)]"
            style={{ height: max > 0 ? `${Math.max(2, (d.commission / max) * 100)}%` : '2px' }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{formatDayLabel(data[0]!.date)}</span>
        {data.length > 1 && <span>{formatDayLabel(data[data.length - 1]!.date)}</span>}
      </div>
      <ul className="sr-only">
        {data
          .filter((d) => d.sales > 0)
          .map((d) => (
            <li
              key={d.date}
            >{`${formatDayLabel(d.date)}: ${formatMoney(d.commission, currency)}`}</li>
          ))}
      </ul>
    </div>
  );
}

function ChannelTable({ data, currency }: { data: SalesSummary; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="Vendas por canal" className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className={th}>
              Canal
            </th>
            <th scope="col" className={`${th} text-right`}>
              Cliques
            </th>
            <th scope="col" className={`${th} text-right`}>
              Vendas
            </th>
            <th scope="col" className={`${th} text-right`}>
              Pendente
            </th>
            <th scope="col" className={`${th} text-right`}>
              Aprovada
            </th>
            <th scope="col" className={`${th} text-right`}>
              Conversão
            </th>
          </tr>
        </thead>
        <tbody>
          {data.byChannel.map((r) => (
            <tr key={r.channelId ?? 'sem-canal'} className="border-t border-border">
              <td className={td}>
                <span className="font-medium">{r.channelName}</span>
                {r.channelKind && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.channelKind === 'WHATSAPP' ? 'WhatsApp' : 'Telegram'}
                  </span>
                )}
              </td>
              <td className={`${td} text-right`}>{formatInt(r.clicks)}</td>
              <td className={`${td} text-right`}>{formatInt(r.sales)}</td>
              <td className={`${td} text-right`}>{formatMoney(r.commissionPending, currency)}</td>
              <td className={`${td} text-right font-semibold`}>
                {formatMoney(r.commissionApproved, currency)}
              </td>
              <td className={`${td} text-right`}>{conversionText(r.conversion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdvertiserTable({ data, currency }: { data: SalesSummary; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="Vendas por loja" className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className={th}>
              Loja
            </th>
            <th scope="col" className={`${th} text-right`}>
              Vendas
            </th>
            <th scope="col" className={`${th} text-right`}>
              Valor vendido
            </th>
            <th scope="col" className={`${th} text-right`}>
              Comissão
            </th>
          </tr>
        </thead>
        <tbody>
          {data.byAdvertiser.map((a) => (
            <tr key={a.advertiserId} className="border-t border-border">
              <td className={td}>{a.advertiserName ?? `Anunciante ${a.advertiserId}`}</td>
              <td className={`${td} text-right`}>{formatInt(a.sales)}</td>
              <td className={`${td} text-right`}>{formatMoney(a.saleAmount, currency)}</td>
              <td className={`${td} text-right font-semibold`}>
                {formatMoney(a.commissionApproved + a.commissionPending, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentSales({ range }: { range: SalesRange }) {
  const [page, setPage] = useState(1);
  const query = useSalesList(range, page);
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <MetricsSection
      id="ultimas-vendas"
      title="Últimas vendas"
      query={query}
      isEmpty={!!data && data.items.length === 0}
      emptyMessage="Nenhuma venda no período."
    >
      {data && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table aria-label="Últimas vendas" className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className={th}>
                    Data
                  </th>
                  <th scope="col" className={th}>
                    Loja
                  </th>
                  <th scope="col" className={th}>
                    Canal
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Venda
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Comissão
                  </th>
                  <th scope="col" className={th}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className={`${td} whitespace-nowrap`}>
                      {formatDateTime(s.transactionDate)}
                    </td>
                    <td className={td}>{s.advertiserName ?? `Anunciante ${s.advertiserId}`}</td>
                    <td className={td}>{s.channelName ?? '—'}</td>
                    <td className={`${td} text-right`}>{formatMoney(s.saleAmount, s.currency)}</td>
                    <td className={`${td} text-right font-semibold`}>
                      {formatMoney(s.commissionAmount, s.currency)}
                    </td>
                    <td className={td}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status]}`}
                      >
                        {STATUS_LABELS[s.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </Button>
              <span className="text-muted-foreground">{`${page} de ${pages}`}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </Button>
            </div>
          )}
        </div>
      )}
    </MetricsSection>
  );
}

function AwinWebhookBlock() {
  const query = useAwinWebhook();
  const rotate = useRotateAwinWebhook();
  // Afiliados não configuram (credenciais são do administrador): a API responde 403.
  if (query.isError) return null;
  const url = query.data?.url;
  async function copy() {
    if (!url) return;
    if (await copyToClipboard(url)) toast.success('URL copiada');
    else toast.error('Não foi possível copiar; selecione e copie manualmente');
  }
  function regenerate() {
    if (!window.confirm('Gerar uma nova URL? A URL atual deixa de funcionar na Awin.')) return;
    rotate.mutate(undefined, {
      onSuccess: () => toast.success('Nova URL gerada — atualize na Awin'),
      onError: () => toast.error('Não foi possível gerar uma nova URL'),
    });
  }
  return (
    <section
      aria-labelledby="awin-webhook-title"
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <h2 id="awin-webhook-title" className="text-lg font-semibold">
        Configurar notificações da Awin
      </h2>
      <p className="text-sm text-muted-foreground">
        Com as notificações ligadas, cada venda chega aqui na hora. Sem elas, as vendas aparecem na
        sincronização automática (de hora em hora).
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-background/60 px-3 py-2 text-xs">
          {url ?? 'Carregando…'}
        </code>
        <div className="flex gap-2">
          <Button size="sm" onClick={copy} disabled={!url}>
            <Copy /> Copiar URL
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={regenerate}
            disabled={!url || rotate.isPending}
          >
            <RefreshCw /> Gerar nova
          </Button>
        </div>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Entre na sua conta da Awin.</li>
        <li>
          Abra <strong>Toolbox → Transaction notifications</strong>.
        </li>
        <li>
          Crie uma notificação com o método <strong>POST</strong> e cole a URL acima.
        </li>
        <li>Salve e use o botão de teste da Awin para conferir.</li>
      </ol>
    </section>
  );
}

export function VendasClient() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [range, setRange] = useState<SalesRange>(() => lastDaysRange(30));
  const summary = useSalesSummary(range);
  const data = summary.data;
  const currency = data && data.currencies.length === 1 ? data.currencies[0]! : 'BRL';

  function choose(d: (typeof PERIODS)[number]) {
    setDays(d);
    setRange(lastDaysRange(d));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vendas</h1>
          <p className="text-sm text-muted-foreground">
            Vendas e comissões da Awin por grupo do WhatsApp e do Telegram.
          </p>
        </div>
        <div role="group" aria-label="Período" className="flex gap-1">
          {PERIODS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? 'default' : 'outline'}
              aria-pressed={days === d}
              onClick={() => choose(d)}
            >
              {`${d} dias`}
            </Button>
          ))}
        </div>
      </div>

      <MetricsSection
        id="vendas-resumo"
        title="Resumo"
        query={summary}
        isEmpty={false}
        emptyMessage=""
        notice={
          data && data.currencies.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              {`Há vendas em mais de uma moeda (${data.currencies.join(', ')}); os totais somam os valores como vieram.`}
            </p>
          ) : undefined
        }
      >
        {data && (
          <div className="space-y-4">
            <Cards data={data} currency={currency} />
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Comissão por dia</h3>
              <DailyBars data={data.daily} currency={currency} />
            </div>
          </div>
        )}
      </MetricsSection>

      <MetricsSection
        id="vendas-canais"
        title="Por canal"
        query={summary}
        isEmpty={!!data && data.byChannel.length === 0}
        emptyMessage="Nenhum clique ou venda atribuída a grupos no período."
      >
        {data && <ChannelTable data={data} currency={currency} />}
      </MetricsSection>

      <MetricsSection
        id="vendas-lojas"
        title="Por loja"
        query={summary}
        isEmpty={!!data && data.byAdvertiser.length === 0}
        emptyMessage="Nenhuma venda no período."
      >
        {data && <AdvertiserTable data={data} currency={currency} />}
      </MetricsSection>

      <RecentSales key={`${range.from}-${range.to}`} range={range} />

      <AwinWebhookBlock />
    </div>
  );
}
