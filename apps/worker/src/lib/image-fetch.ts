import { assertPublicHttpUrl } from './safe-url';

const MEDIA_MAX_REDIRECTS = 3;

/**
 * Baixa o buffer de uma imagem validando contra SSRF (apenas HTTP/HTTPS em hosts públicos).
 */
export async function downloadImageBuffer(url?: string): Promise<Buffer | undefined> {
  if (!url) return undefined;
  try {
    let current = url;
    let res: Response | undefined;

    for (let hop = 0; hop <= MEDIA_MAX_REDIRECTS; hop++) {
      const safe = await assertPublicHttpUrl(current);
      res = await fetch(safe, {
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(10_000),
      });

      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      void res.body?.cancel?.().catch(() => {});
      current = new URL(location, safe).toString();
      res = undefined;
    }

    if (!res || !res.ok) return undefined;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return undefined;
  }
}
