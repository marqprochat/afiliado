'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/app-shell/status-pill';
import { apiFetch } from '@/lib/api';
import type { MarketplaceConnection } from '@/lib/types';

export function TagConnectionForm({
  connection,
  title,
  description,
  kind,
  tagLabel,
  tagPlaceholder,
  tagHelp,
  onSaved,
}: {
  connection?: MarketplaceConnection;
  title: string;
  description: string;
  kind: 'AMAZON' | 'MAGALU' | 'MERCADOLIVRE';
  tagLabel?: string;
  tagPlaceholder?: string;
  tagHelp?: string;
  onSaved?: () => void;
}) {
  const [affiliateTag, setAffiliateTag] = useState(connection?.affiliateTag ?? '');
  const [mattWord, setMattWord] = useState(connection?.mattWord ?? '');
  const [mattTool, setMattTool] = useState(connection?.mattTool ?? '');
  const [feedback, setFeedback] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (body: { affiliateTag?: string; mattWord?: string; mattTool?: string }) =>
      apiFetch<MarketplaceConnection>(`/marketplaces/${kind}`, {
        method: 'PUT',
        json: body,
      }),
    onSuccess: () => {
      setFeedback('Configurações salvas com sucesso!');
      onSaved?.();
    },
    onError: (err: Error) => {
      setFeedback(err.message || 'Falha ao salvar configurações.');
    },
  });

  const checkMutation = useMutation({
    mutationFn: () =>
      apiFetch<MarketplaceConnection>(`/marketplaces/${kind}/check`, {
        method: 'POST',
      }),
    onSuccess: (data: MarketplaceConnection) => {
      if (data.status === 'OK') {
        setFeedback('Conexão validada com sucesso!');
      } else {
        setFeedback(data.lastError ?? 'Falha na validação das credenciais.');
      }
      onSaved?.();
    },
    onError: (err: Error) => {
      setFeedback(err.message || 'Falha ao testar conexão.');
    },
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (kind === 'MERCADOLIVRE') {
      await saveMutation.mutateAsync({
        mattWord: mattWord.trim(),
        mattTool: mattTool.trim(),
      });
    } else {
      await saveMutation.mutateAsync({
        affiliateTag: affiliateTag.trim(),
      });
    }
  };

  const handleCheck = async () => {
    setFeedback(null);
    await checkMutation.mutateAsync();
  };

  const status = connection?.status ?? 'UNCONFIGURED';

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <StatusPill label={status} status={status} />
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-xl border border-border bg-card p-6">
        {kind === 'MERCADOLIVRE' ? (
          <>
            <div className="rounded-lg bg-surface-2 p-3.5 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Como obter suas credenciais:</p>
              <p>
                No painel de afiliados do Mercado Livre, gere um link de qualquer produto, abra-o no
                navegador e copie os valores de <code>matt_word</code> e <code>matt_tool</code> da
                URL final.
              </p>
              <p className="italic text-brand/90 pt-1">
                Com a extensão Afilados Connect e a sessão do Mercado Livre sincronizada, o link
                oficial curto (meli.la) é gerado automaticamente; estes campos ficam como fallback.
              </p>
            </div>

            <div>
              <Label htmlFor="matt_word">matt_word (ID de Afiliado)</Label>
              <Input
                id="matt_word"
                placeholder="Ex: minhaid"
                value={mattWord}
                onChange={(e) => setMattWord(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="matt_tool">matt_tool (Código da Ferramenta/Conta)</Label>
              <Input
                id="matt_tool"
                placeholder="Ex: 12345678"
                value={mattTool}
                onChange={(e) => setMattTool(e.target.value)}
                className="mt-1"
              />
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="affiliate_tag">{tagLabel ?? 'Tag de Afiliado'}</Label>
            <Input
              id="affiliate_tag"
              placeholder={tagPlaceholder ?? 'Ex: minha-tag-20'}
              value={affiliateTag}
              onChange={(e) => setAffiliateTag(e.target.value)}
              className="mt-1"
            />
            {tagHelp && <p className="mt-1.5 text-xs text-muted-foreground">{tagHelp}</p>}
          </div>
        )}

        {feedback && (
          <p
            className={`text-xs ${feedback.includes('sucesso') ? 'text-emerald-500' : 'text-red-400'}`}
          >
            {feedback}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar credenciais'}
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={checkMutation.isPending || saveMutation.isPending}
            onClick={handleCheck}
          >
            {checkMutation.isPending ? 'Testando...' : 'Testar conexão'}
          </Button>
        </div>
      </form>
    </div>
  );
}
