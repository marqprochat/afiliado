'use client';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function SiteLinksToggle({
  enabled,
  onChange,
  saving,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  saving?: boolean;
}) {
  return (
    <fieldset className="grid max-w-xl gap-2 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">Link do site nas ofertas</legend>
      <div className="flex items-center gap-2">
        <Switch
          id="site-links"
          aria-label="Usar o link do site nas ofertas postadas"
          checked={enabled}
          disabled={saving ?? false}
          onCheckedChange={(v) => onChange(v)}
        />
        <Label htmlFor="site-links">Usar o link do site nas ofertas postadas</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        As ofertas enviadas aos grupos levam o link da página do produto em /ofertas, com comparativo
        de preços, cupom e o botão para a loja com o seu link de afiliado. Se a página não puder ser
        montada, a mensagem sai com o link de afiliado direto.
      </p>
    </fieldset>
  );
}
