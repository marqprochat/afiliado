export interface SyncResult {
  source: 'ALIEXPRESS' | 'AWIN' | 'EXPIRY';
  ok: boolean;
  created: number;
  updated: number;
  expired: number;
  error?: string;
}

const LABEL: Record<SyncResult['source'], string> = {
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Awin',
  EXPIRY: 'Expiração',
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatSyncResults(results: SyncResult[] | undefined): string {
  if (!results || results.length === 0) return 'Cupons sincronizados com sucesso!';
  return results
    .map((r) => {
      if (!r.ok) return `${LABEL[r.source]}: erro — ${r.error ?? 'falha desconhecida'}`;
      const parts: string[] = [];
      if (r.source !== 'EXPIRY') {
        parts.push(plural(r.created, 'novo', 'novos'));
        parts.push(plural(r.updated, 'atualizado', 'atualizados'));
      }
      if (r.expired > 0) parts.push(plural(r.expired, 'expirado', 'expirados'));
      else if (r.source === 'EXPIRY') parts.push('nenhum expirado');
      return `${LABEL[r.source]}: ${parts.join(', ')}`;
    })
    .join(' · ');
}
