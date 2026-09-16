'use client';
import Link from 'next/link';
import { StatusPill } from '@/components/app-shell/status-pill';
import { formatDateTime } from '@/lib/format';
import { useOverview } from '@/lib/queries';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export default function OverviewPage() {
  const { data } = useOverview();
  if (!data) return <p className="text-muted-foreground">Carregando…</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Visão Geral</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="WhatsApp">
          {data.wa.length === 0 && (
            <Link href="/config/whatsapp" className="text-brand underline">
              Conectar um número
            </Link>
          )}
          {data.wa.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-1 text-sm">
              <span>
                {s.label} {s.phone && <span className="text-muted-foreground">+{s.phone}</span>}
              </span>
              <StatusPill label={s.status} status={s.status} />
            </div>
          ))}
        </Card>
        <Card title="Shopee">
          <StatusPill label={data.shopee} status={data.shopee} />{' '}
          <Link href="/marketplaces?open=SHOPEE" className="ml-2 text-xs text-brand underline">
            configurar
          </Link>
        </Card>
        <Card title="Fila de produtos">
          <p className="text-3xl font-bold">
            {data.queue.count}
            <span className="text-base text-muted-foreground"> / {data.queue.limit}</span>
          </p>
          <Link href="/produtos" className="text-xs text-brand underline">
            buscar produtos
          </Link>
        </Card>
      </div>
      <Card title="Lotes ativos">
        {data.batches.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum lote em andamento.</p>
        )}
        {data.batches.map((b) => (
          <div key={b.id} className="py-2 text-sm">
            <div className="flex items-center gap-2">
              <b>{b.name}</b>
              <StatusPill label={b.status} status={b.status} />
              <span className="ml-auto text-xs text-muted-foreground">
                {b.sent}/{b.total} · término {formatDateTime(b.estimatedEndAt)}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-surface-2">
              <div
                className="h-full rounded bg-brand"
                style={{ width: `${b.total ? Math.round((b.sent / b.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </Card>
      <Card title="Últimos erros de envio">
        {data.errors.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem erros recentes.</p>
        )}
        <ul className="space-y-1 text-xs">
          {data.errors.map((e) => (
            <li key={e.id}>
              <span className="text-muted-foreground">{formatDateTime(e.sentAt)}</span> ·{' '}
              {e.groupJid} · <span className="text-red-300">{e.error}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
