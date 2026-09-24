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

const MIRROR_REASON_LABELS: Record<string, string> = {
  'no-links': 'Sem links',
  'short-link-unresolved': 'Link encurtado não abriu',
  duplicate: 'Duplicado',
  'template->clone': 'Enviado como cópia',
  WA_NOT_CONNECTED: 'WhatsApp desconectado',
  'No sessions': 'Falha de sessão',
  'Connection Closed': 'Conexão caiu',
  'Timed Out': 'Tempo esgotado',
};

const MIRROR_STORE_LABELS: Record<string, string> = {
  AMAZON: 'Amazon',
  MERCADOLIVRE: 'Mercado Livre',
  MAGALU: 'Magalu',
  SHOPEE: 'Shopee',
  ALIEXPRESS: 'AliExpress',
  AWIN: 'Awin',
};

function translateSingleMirrorReason(token: string): string {
  const trimmed = token.trim();
  if (MIRROR_REASON_LABELS[trimmed]) return MIRROR_REASON_LABELS[trimmed];
  const match = trimmed.match(/^unsupported-store:(.+)$/);
  if (match) {
    const stores = match[1]!
      .split(',')
      .map((s) => MIRROR_STORE_LABELS[s] ?? s)
      .join(', ');
    return `Sem credencial: ${stores}`;
  }
  return trimmed;
}

export function translateMirrorReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return reason.split(';').map(translateSingleMirrorReason).join(', ');
}
