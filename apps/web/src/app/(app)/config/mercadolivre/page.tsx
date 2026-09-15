'use client';
import { useQueryClient } from '@tanstack/react-query';
import { TagConnectionForm } from '@/components/settings/tag-connection-form';
import { useMarketplaces } from '@/lib/queries';

export default function MercadoLivreConfigPage() {
  const qc = useQueryClient();
  const { data: marketplaces = [] } = useMarketplaces();
  const mlConn = marketplaces.find((m) => m.kind === 'MERCADOLIVRE');

  return (
    <TagConnectionForm
      connection={mlConn}
      title="Conexão Mercado Livre"
      description="Configure seus identificadores de afiliado do Mercado Livre para substituição nos links espelhados."
      kind="MERCADOLIVRE"
      onSaved={() => void qc.invalidateQueries({ queryKey: ['marketplaces'] })}
    />
  );
}
