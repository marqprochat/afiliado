const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
];

export async function fetchHtml(url: string, timeoutMs = 8000): Promise<string> {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ao acessar ${url}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function parseMoney(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  // Limpa caracteres, mantém dígitos e vírgula/ponto decimal
  // Formatos: "R$ 1.299,90", "1299.90", "R$ 49,99", "1.299"
  const cleaned = raw.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return undefined;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // Ex: 1.299,90 -> 1299.90
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // Ex: 1299,90 -> 1299.90
    normalized = cleaned.replace(',', '.');
  }

  const num = parseFloat(normalized);
  return isNaN(num) ? undefined : num;
}
