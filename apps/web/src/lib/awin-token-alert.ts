import type { MarketplaceConnection } from '@/lib/types';

export interface AwinTokenAlert {
  tone: 'warn' | 'error';
  message: string;
}

/** Aviso de validade do token da Awin: amarelo até 7 dias antes de vencer, vermelho depois. */
export function awinTokenAlert(
  conn:
    | Pick<MarketplaceConnection, 'kind' | 'awinTokenDaysLeft' | 'awinTokenExpiresAt'>
    | null
    | undefined,
): AwinTokenAlert | null {
  if (!conn || conn.kind !== 'AWIN') return null;
  const days = conn.awinTokenDaysLeft;
  if (days === null || days === undefined || days > 7) return null;
  if (days < 0) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(conn.awinTokenExpiresAt ?? '');
    const date = m ? `${m[3]}/${m[2]}/${m[1]}` : null;
    return {
      tone: 'error',
      message: date ? `Token da Awin venceu em ${date}` : 'Token da Awin venceu',
    };
  }
  return {
    tone: 'warn',
    message:
      days === 0
        ? 'Token da Awin vence hoje'
        : days === 1
          ? 'Token da Awin vence em 1 dia'
          : `Token da Awin vence em ${days} dias`,
  };
}
