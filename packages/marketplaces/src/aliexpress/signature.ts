import { createHmac } from 'node:crypto';

/**
 * Gera a assinatura HMAC-SHA256 no padrão do AliExpress Open Platform (TOP/IOP).
 * Concatena as chaves e valores ordenados lexicograficamente e gera hash HMAC-SHA256
 * com a appSecret, retornando em formato hexadecimal maiúsculo.
 */
export function signAliexpressRequest(
  params: Record<string, unknown>,
  appSecret: string,
): string {
  const p = { ...params };
  delete p.sign;

  let basestring = '';
  if (typeof p.method === 'string' && p.method.includes('/')) {
    basestring = p.method;
    delete p.method;
  }

  basestring += Object.entries(p)
    .filter(([_, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((acc, [key, value]) => acc + key + String(value), '');

  return createHmac('sha256', appSecret)
    .update(basestring, 'utf8')
    .digest('hex')
    .toUpperCase();
}
