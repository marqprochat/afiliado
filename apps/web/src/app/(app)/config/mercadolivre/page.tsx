'use client';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { TagConnectionForm } from '@/components/settings/tag-connection-form';
import { useMarketplaces } from '@/lib/queries';

export default function MercadoLivreConfigPage() {
  const qc = useQueryClient();
  const { data: marketplaces = [] } = useMarketplaces();
  const mlConn = marketplaces.find((m) => m.kind === 'MERCADOLIVRE');

  const syncedAt = mlConn?.mlSessionSyncedAt ?? null;

  return (
    <div className="space-y-4">
      <TagConnectionForm
        connection={mlConn}
        title="Conexão Mercado Livre"
        description="Configure seus identificadores de afiliado do Mercado Livre. Eles são o fallback quando a sessão da extensão não está disponível."
        kind="MERCADOLIVRE"
        onSaved={() => void qc.invalidateQueries({ queryKey: ['marketplaces'] })}
      />

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Link oficial (meli.la) via extensão</h3>
            <p className="text-sm text-muted-foreground">
              Com a sessão do Mercado Livre sincronizada pela extensão Afilados Connect, os links
              são gerados pelo painel oficial de afiliados. Se a sessão expirar, o sistema volta a
              usar matt_word/matt_tool automaticamente.
            </p>
          </div>
          <span
            className={
              'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ' +
              (syncedAt ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground')
            }
          >
            {syncedAt
              ? `Sincronizada em ${new Date(syncedAt).toLocaleString('pt-BR')}`
              : 'Não sincronizada'}
          </span>
        </div>
        {!syncedAt && (
          <p className="mt-3 text-sm">
            Instale a extensão em{' '}
            <Link href="/config/extensao" className="text-brand underline">
              Configurações → Extensão
            </Link>
            , faça login no Mercado Livre no navegador e clique em “Sincronizar sessão” no popup.
          </p>
        )}
      </div>
    </div>
  );
}
