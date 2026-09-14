export function formatBRL(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export type Tone = 'ok' | 'warn' | 'muted' | 'error';
export function statusTone(status: string): Tone {
  switch (status) {
    case 'CONNECTED':
    case 'OK':
    case 'SENT':
    case 'DONE':
      return 'ok';
    case 'CONNECTING':
    case 'NEEDS_QR':
    case 'RUNNING':
    case 'SCHEDULED':
    case 'PAUSED':
    case 'SENDING':
    case 'PENDING':
      return 'warn';
    case 'ERROR':
    case 'LOGGED_OUT':
    case 'CANCELLED':
      return 'error';
    default:
      return 'muted';
  }
}
