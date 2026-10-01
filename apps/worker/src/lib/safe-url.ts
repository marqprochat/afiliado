import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

export type LookupAll = (
  hostname: string,
  options: { all: true },
) => Promise<{ address: string; family: number }[]>;

/** IPv4 (4 octetos) em faixa loopback/privada/link-local/CGNAT/multicast/reservada. */
function isBlockedIpv4(parts: number[]): boolean {
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Expande um IPv6 em 8 grupos de 16 bits (aceita `::` e cauda IPv4). */
function expandIpv6(ip: string): number[] | null {
  let addr = ip;
  const tail = addr.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const o = tail.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    addr =
      addr.slice(0, addr.length - tail[0].length) +
      `${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const nums = groups.map((g) => parseInt(g, 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? nums
    : null;
}

/** `true` para IPs que não são alcançáveis publicamente (ou que não conseguimos interpretar). */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(bare);
  if (family === 4) return isBlockedIpv4(bare.split('.').map(Number));
  if (family !== 6) return true;
  const g = expandIpv6(bare);
  if (!g) return true;
  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  // IPv4 mapeado (::ffff:a.b.c.d) ou compatível (::a.b.c.d): vale a regra do IPv4 embutido
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isBlockedIpv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  return false;
}

/**
 * Garante que a URL é http(s) e aponta só para endereços públicos (anti-SSRF).
 * Resolve o DNS e rejeita se QUALQUER endereço resolvido estiver em faixa bloqueada.
 * Devolve a URL já interpretada.
 */
export async function assertPublicHttpUrl(
  rawUrl: string,
  lookup: LookupAll = dns.lookup as unknown as LookupAll,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Protocolo não permitido: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('URL sem host');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error(`Host bloqueado: ${host}`);
  }
  if (isIP(host.replace(/^\[|\]$/g, ''))) {
    if (isBlockedIp(host)) throw new Error(`Endereço IP privado/bloqueado: ${host}`);
    return url;
  }
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0) throw new Error(`Host não resolve: ${host}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(`Host ${host} resolve para endereço privado/bloqueado`);
    }
  }
  return url;
}
