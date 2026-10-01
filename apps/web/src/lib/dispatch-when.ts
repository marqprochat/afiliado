/** Tolerância entre o envio "agora" e o `firstRunAt` devolvido pela API. */
const NOW_TOLERANCE_MS = 60_000;

/**
 * `true` quando o primeiro envio ficou para depois (ex.: "Enviar agora" fora da janela de
 * operação, reagendado para a abertura) — a tela deve mostrar o horário.
 */
export function isScheduledLater(firstRunAt: string, now: number = Date.now()): boolean {
  return new Date(firstRunAt).getTime() - now > NOW_TOLERANCE_MS;
}

export function formatRunAt(firstRunAt: string): string {
  return new Date(firstRunAt).toLocaleString('pt-BR');
}
