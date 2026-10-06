import type { MarketplaceKind } from './enums';

/** Credenciais das lojas convertidas por parâmetros na URL (sem API). */
export interface TagCredentials {
  tag?: string; // Amazon: "SEUID-20"; Magalu: nome da loja em magazinevoce.com.br/<loja>. Mercado Livre: etiqueta de afiliado usada no gerador meli.la (vazio = etiqueta padrão da conta)
  mattWord?: string; // Mercado Livre: ID do afiliado
  mattTool?: string; // Mercado Livre: número fixo da conta
  /** Sessão logada do Mercado Livre; permite gerar o link oficial meli.la. */
  mlSession?: SessionCookies;
  /** Sessão logada da Amazon (SiteStripe); armazenada nesta fase, sem uso na geração de link ainda. */
  amazonSession?: SessionCookies;
  /** Sessão logada do Magazine Você; armazenada nesta fase, sem uso na geração de link ainda. */
  magaluSession?: SessionCookies;
  /** Credenciais da Creators API (Client ID/Secret) — usadas para buscar dados de produto via GetItems. */
  amazonApi?: { clientId: string; clientSecret: string };
  /**
   * Conexão OAuth com a API oficial do Mercado Livre (dados de produto de catálogo). Client ID e
   * Secret do app ficam no .env (ML_CLIENT_ID/ML_CLIENT_SECRET), não aqui. `refreshToken` é de uso
   * único (cada renovação devolve um novo); `accessToken`/`expiresAt` são preenchidos em memória ao
   * carregar as credenciais e gravados junto quando renovados. Datas em ISO 8601.
   */
  mlApi?: {
    refreshToken: string;
    accessToken?: string | undefined;
    expiresAt?: string | undefined;
    userId?: string | undefined;
    connectedAt?: string | undefined;
  };
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

/**
 * Categorias raiz do Mercado Livre aceitas em `/ofertas?category=<id>`. A API pública de categorias
 * responde 403 para este app, então a lista é estática; cada id foi conferido abrindo a página.
 */
export const ML_DEAL_CATEGORIES = [
  { id: 'MLB1051', label: 'Celulares e Telefones' },
  { id: 'MLB1648', label: 'Informática' },
  { id: 'MLB1000', label: 'Eletrônicos, Áudio e Vídeo' },
  { id: 'MLB1144', label: 'Games' },
  { id: 'MLB5726', label: 'Eletrodomésticos' },
  { id: 'MLB1574', label: 'Casa, Móveis e Decoração' },
  { id: 'MLB1246', label: 'Beleza e Cuidado Pessoal' },
  { id: 'MLB1430', label: 'Calçados, Roupas e Bolsas' },
  { id: 'MLB3937', label: 'Joias e Relógios' },
  { id: 'MLB1276', label: 'Esportes e Fitness' },
  { id: 'MLB1132', label: 'Brinquedos e Hobbies' },
  { id: 'MLB1384', label: 'Bebês' },
  { id: 'MLB1500', label: 'Construção' },
  { id: 'MLB263532', label: 'Ferramentas' },
  { id: 'MLB5672', label: 'Acessórios para Veículos' },
  { id: 'MLB1403', label: 'Alimentos e Bebidas' },
  { id: 'MLB1071', label: 'Animais' },
  { id: 'MLB1039', label: 'Câmeras e Acessórios' },
  { id: 'MLB1182', label: 'Instrumentos Musicais' },
  { id: 'MLB1196', label: 'Livros, Revistas e Comics' },
] as const;
