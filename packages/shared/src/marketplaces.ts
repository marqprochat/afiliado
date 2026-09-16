import type { MarketplaceKind } from './enums';

/** Credenciais das lojas convertidas por parâmetros na URL (sem API). */
export interface TagCredentials {
  tag?: string; // Amazon: "SEUID-20"; Magalu: nome da loja em magazinevoce.com.br/<loja>
  mattWord?: string; // Mercado Livre: ID do afiliado
  mattTool?: string; // Mercado Livre: número fixo da conta
  /** Sessão logada sincronizada pela extensão (F3); permite gerar o link oficial meli.la. */
  mlSession?: MlSession;
}

/** Cookies da sessão do Mercado Livre, sincronizados pela extensão Afilados Connect. */
export interface MlSession {
  cookies: Record<string, string>;
  syncedAt: string; // ISO
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
