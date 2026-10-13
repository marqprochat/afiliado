import { METRICS_TIMEZONE } from '@afilados/shared';

export const formatInt = (n: number) => n.toLocaleString('pt-BR');
export const formatSigned = (n: number) => (n > 0 ? `+${formatInt(n)}` : formatInt(n));
export const formatPct = (n: number) =>
  `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
/** `YYYY-MM-DD` → `DD/MM` */
export const formatDayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** ISO → `DD/MM/AAAA` no fuso de SP */
export const formatDateBR = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: METRICS_TIMEZONE });

export const MARKETPLACE_LABELS: Record<string, string> = {
  SHOPEE: 'Shopee',
  MERCADOLIVRE: 'Mercado Livre',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  AWIN: 'Awin',
  ALIEXPRESS: 'AliExpress',
  MANUAL: 'Manual',
};
