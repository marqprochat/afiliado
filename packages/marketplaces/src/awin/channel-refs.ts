export interface AwinChannelRefs {
  /** Código do canal (WaGroup/TelegramChat.trackCode) → `clickref2`. */
  channel?: string | null | undefined;
  /** ID do lote → `clickref3`. */
  batch?: string | null | undefined;
}

/** Mesma regra dos clickrefs atuais: só letras e números, até 50. */
function cleanRef(v: string | null | undefined): string {
  return (v ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
}

function isAwinCread(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  return host === 'awin1.com' && u.pathname === '/cread.php';
}

/**
 * Põe o canal (`clickref2`) e o lote (`clickref3`) num deep link da Awin (`awin1.com/cread.php`),
 * sobrescrevendo valores anteriores. O `clickref` (subId do afiliado ou padrão) fica como está.
 * Qualquer outra URL (ou sem refs válidos) volta idêntica.
 */
export function withAwinChannelRefs(url: string, refs: AwinChannelRefs): string {
  const channel = cleanRef(refs.channel);
  const batch = cleanRef(refs.batch);
  if (!channel && !batch) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!isAwinCread(u)) return url;
  if (channel) u.searchParams.set('clickref2', channel);
  if (batch) u.searchParams.set('clickref3', batch);
  return u.toString();
}
