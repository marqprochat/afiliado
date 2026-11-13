import { headers } from 'next/headers';

/**
 * Obtém a URL base absoluta no lado do servidor para compor tags Open Graph / Twitter Cards.
 * Respeita variáveis de ambiente (NEXT_PUBLIC_APP_URL, WEB_ORIGIN) e cabeçalhos de requisição (Host / X-Forwarded-Host).
 */
export async function getServerBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.WEB_ORIGIN) {
    return process.env.WEB_ORIGIN.replace(/\/$/, '');
  }
  try {
    const headersList = await headers();
    const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000';
    const proto = headersList.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return 'http://localhost:3000';
  }
}
