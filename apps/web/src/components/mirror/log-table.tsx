'use client';
import { StatusPill } from '@/components/app-shell/status-pill';
import { formatDateTime } from '@/lib/format';
import type { MirrorLog } from '@/lib/types';

export function MirrorLogTable({
  logs,
  statusFilter,
  onStatusFilterChange,
}: {
  logs: MirrorLog[];
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="font-semibold text-foreground">Logs de espelhamento em tempo real</h3>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtrar status:</span>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-surface-2 px-2 text-xs"
          >
            <option value="">Todos</option>
            <option value="MIRRORED">Espelhados</option>
            <option value="DISCARDED">Descartados</option>
            <option value="ERROR">Erros</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-2/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Data / Hora</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Origem → Destino</th>
              <th className="px-4 py-3 font-medium">Produto</th>
              <th className="px-4 py-3 font-medium">Detalhes / Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum log registrado ainda.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-surface-2/30 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {log.status === 'MIRRORED' && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                        Espelhado
                      </span>
                    )}
                    {log.status === 'DISCARDED' && (
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
                        Descartado
                      </span>
                    )}
                    {log.status === 'ERROR' && (
                      <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                        Erro
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-xs truncate">
                    <span className="font-medium text-foreground">
                      {log.sourceName || log.sourceJid}
                    </span>
                    <span className="text-muted-foreground mx-1">→</span>
                    <span className="text-foreground">{log.targetName || log.targetJid}</span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {log.productKey ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-sm truncate">
                    {log.reason ?? (log.waMessageId ? `WA ID: ${log.waMessageId}` : '-')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
