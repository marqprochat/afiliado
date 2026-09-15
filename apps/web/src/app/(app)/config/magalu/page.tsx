'use client';
import { useQueryClient } from '@tanstack/react-query';
import { TagConnectionForm } from '@/components/settings/tag-connection-form';
import { useMarketplaces } from '@/lib/queries';

export default function MagaluConfigPage() {
  const qc = useQueryClient();
  const { data: marketplaces = [] } = useMarketplaces();
  const magaluConn = marketplaces.find((m) => m.kind === 'MAGALU');

  return (
    <TagConnectionForm
      connection={magaluConn}
      title="Conexão Magazine Luiza (Magazine Você)"
      description="Configure o identificador da sua loja no Magazine Você para reescrever links de produtos do Magalu."
      kind="MAGALU"
      tagLabel="Nome da Loja (Magazine Você)"
      tagPlaceholder="Ex: minhaloja"
      tagHelp="O identificador da sua loja em magazinevoce.com.br/<sua-loja>."
      onSaved={() => void qc.invalidateQueries({ queryKey: ['marketplaces'] })}
    />
  );
}
