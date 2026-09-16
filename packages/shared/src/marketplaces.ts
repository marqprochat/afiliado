import type { MarketplaceKind } from './enums';

/** Credenciais das lojas convertidas por parâmetros na URL (sem API). */
export interface TagCredentials {
  tag?: string; // Amazon: "SEUID-20"; Magalu: nome da loja em magazinevoce.com.br/<loja>
  mattWord?: string; // Mercado Livre: ID do afiliado
  mattTool?: string; // Mercado Livre: número fixo da conta
  /** Sessão logada do Mercado Livre; permite gerar o link oficial meli.la. */
  mlSession?: SessionCookies;
  /** Sessão logada da Amazon (SiteStripe); armazenada nesta fase, sem uso na geração de link ainda. */
  amazonSession?: SessionCookies;
  /** Sessão logada do Magazine Você; armazenada nesta fase, sem uso na geração de link ainda. */
  magaluSession?: SessionCookies;
}

/** Cookies de sessão de um marketplace, sincronizados pela extensão ou colados manualmente. */
export interface SessionCookies {
  cookies: Record<string, string>;
  syncedAt: string; // ISO
  source?: 'extension' | 'manual';
}

/** @deprecated use SessionCookies — mantido para não quebrar imports existentes. */
export type MlSession = SessionCookies;

/** Mapa de qual campo de `TagCredentials` guarda a sessão de cada marketplace. */
export const SESSION_FIELD_BY_KIND: Record<
  'MERCADOLIVRE' | 'AMAZON' | 'MAGALU',
  'mlSession' | 'amazonSession' | 'magaluSession'
> = {
  MERCADOLIVRE: 'mlSession',
  AMAZON: 'amazonSession',
  MAGALU: 'magaluSession',
};

export function supportsSessionCookie(
  kind: MarketplaceKind,
): kind is 'MERCADOLIVRE' | 'AMAZON' | 'MAGALU' {
  return kind === 'MERCADOLIVRE' || kind === 'AMAZON' || kind === 'MAGALU';
}

export function requiredTagFields(kind: MarketplaceKind): (keyof TagCredentials)[] {
  switch (kind) {
    case 'AMAZON':
    case 'MAGALU':
      return ['tag'];
    case 'MERCADOLIVRE':
      return ['mattWord', 'mattTool'];
    default:
      return [];
  }
}

export function hasTagCredentials(
  kind: MarketplaceKind,
  creds: TagCredentials | null | undefined,
): boolean {
  if (!creds) return false;
  return requiredTagFields(kind).every((f) => typeof creds[f] === 'string' && creds[f]!.length > 0);
}
