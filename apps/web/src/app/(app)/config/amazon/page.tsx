'use client';
import { useQueryClient } from '@tanstack/react-query';
import { TagConnectionForm } from '@/components/settings/tag-connection-form';
import { useMarketplaces } from '@/lib/queries';

export default function AmazonConfigPage() {
  const qc = useQueryClient();
  const { data: marketplaces = [] } = useMarketplaces();
  const amazonConn = marketplaces.find((m) => m.kind === 'AMAZON');

  return (
    <TagConnectionForm
      connection={amazonConn}
      title="Conexão Amazon"
      description="Configure sua tag de associado da Amazon para substituição automática nos links espelhados."
      kind="AMAZON"
      tagLabel="Tag de Associado Amazon"
      tagPlaceholder="Ex: seunome-20"
      tagHelp="Informe a sua Store ID / Tracking ID do Programa de Associados Amazon."
      onSaved={() => void qc.invalidateQueries({ queryKey: ['marketplaces'] })}
    />
  );
}
