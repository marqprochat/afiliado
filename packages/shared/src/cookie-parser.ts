const DEFAULT_COOKIE_NAME: Record<'MERCADOLIVRE' | 'AMAZON' | 'MAGALU', string> = {
  MERCADOLIVRE: 'MELI_SESSION',
  AMAZON: 'session-id',
  MAGALU: 'magalu_session',
};

const COOKIE_NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Converte uma string de cookie colada pelo usuário em um mapa nome→valor.
 * Só interpreta como múltiplos cookies (formato "nome=valor; nome=valor")
 * quando TODOS os segmentos separados por ";" têm um nome "seguro" antes do
 * primeiro "=" — evita quebrar um valor único em base64 que contenha "="
 * de padding. Caso contrário, a string inteira vira o valor do cookie
 * padrão daquele marketplace.
 */
export function parseCookieString(
  raw: string,
  kind: 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.includes(';')) {
    const segments = trimmed
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const cookies: Record<string, string> = {};
    let allValid = segments.length > 0;
    for (const segment of segments) {
      const idx = segment.indexOf('=');
      const name = idx > 0 ? segment.slice(0, idx).trim() : '';
      if (idx <= 0 || !COOKIE_NAME_RE.test(name)) {
        allValid = false;
        break;
      }
      cookies[name] = segment.slice(idx + 1).trim();
    }
    if (allValid) return cookies;
  }

  return { [DEFAULT_COOKIE_NAME[kind]]: trimmed };
}
