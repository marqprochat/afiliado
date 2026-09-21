import type { MarketplaceKind } from '@afilados/shared';

export type MarketplaceFieldKey =
  | 'appId'
  | 'secret'
  | 'affiliateTag'
  | 'mattWord'
  | 'mattTool'
  | 'amazonClientId'
  | 'amazonClientSecret';

export interface MarketplaceFieldDef {
  key: MarketplaceFieldKey;
  label: string;
  type: 'text' | 'password';
  required: boolean;
  placeholder?: string;
  helpTitle?: string;
  helpContent?: string;
}

export interface MarketplaceConfig {
  kind: MarketplaceKind;
  label: string;
  description: string;
  platformUrl: string;
  fields: MarketplaceFieldDef[];
  supportsSession: boolean;
  sessionCookieName?: string;
  sessionHelpTitle?: string;
  sessionHelpContent?: string;
  /** Só o Mercado Livre tem extensão hoje; exibe um link extra de instalação. */
  extensionUrl?: string;
}

export const MARKETPLACE_CONFIGS: Record<MarketplaceKind, MarketplaceConfig> = {
  SHOPEE: {
    kind: 'SHOPEE',
    label: 'Shopee',
    description: 'Credenciais da Shopee Affiliate Open Platform.',
    platformUrl: 'https://affiliate.shopee.com.br/',
    fields: [
      { key: 'appId', label: 'App Key', type: 'text', required: true },
      { key: 'secret', label: 'Secret', type: 'password', required: true },
      { key: 'affiliateTag', label: 'Tag de afiliado (opcional)', type: 'text', required: false },
    ],
    supportsSession: false,
  },
  MERCADOLIVRE: {
    kind: 'MERCADOLIVRE',
    label: 'Mercado Livre',
    description:
      'Identificadores de afiliado do Mercado Livre — usados como fallback quando a sessão não está sincronizada.',
    platformUrl: 'https://www.mercadolivre.com.br/afiliados',
    fields: [
      {
        key: 'mattWord',
        label: 'matt_word (ID de Afiliado)',
        type: 'text',
        required: true,
        placeholder: 'Ex: minhaid',
        helpTitle: 'Onde encontrar meu matt_word/matt_tool?',
        helpContent:
          'No painel de afiliados do Mercado Livre, gere um link de qualquer produto, abra-o no navegador e copie os valores de matt_word e matt_tool da URL final.',
      },
      {
        key: 'mattTool',
        label: 'matt_tool (Código da Ferramenta/Conta)',
        type: 'text',
        required: true,
        placeholder: 'Ex: 12345678',
      },
    ],
    supportsSession: true,
    sessionCookieName: 'MELI_SESSION',
    sessionHelpTitle: 'Como exportar o cookie?',
    sessionHelpContent:
      'Com a sessão logada no Mercado Livre, abra o DevTools do navegador → Application → Cookies → mercadolivre.com.br e copie o valor do cookie MELI_SESSION (ou cole todos os cookies do domínio, separados por ";").',
    extensionUrl: '/config/extensao',
  },
  AMAZON: {
    kind: 'AMAZON',
    label: 'Amazon BR',
    description: 'Tag de afiliado e credenciais da Creators API (dados de produto).',
    platformUrl: 'https://afiliados.amazon.com.br/',
    fields: [
      {
        key: 'affiliateTag',
        label: 'Tag de Associado Amazon',
        type: 'text',
        required: true,
        placeholder: 'Ex: seunome-20',
        helpTitle: 'Onde encontrar minha tag?',
        helpContent: 'É a sua Store ID / Tracking ID no Programa de Associados Amazon.',
      },
      {
        key: 'amazonClientId',
        label: 'Client ID (Creators API)',
        type: 'text',
        required: false,
        placeholder: 'Ex: amzn1.application-oa2-client....',
        helpTitle: 'Onde consigo o Client ID?',
        helpContent:
          'Em Associates Central → Ferramentas → Creators API → Register for Creators API. Exige pelo menos 10 vendas qualificadas nos últimos 30 dias.',
      },
      {
        key: 'amazonClientSecret',
        label: 'Client Secret (Creators API)',
        type: 'password',
        required: false,
        helpTitle: 'Onde consigo o Client Secret?',
        helpContent: 'Gerado junto com o Client ID no mesmo cadastro da Creators API.',
      },
    ],
    supportsSession: true,
    sessionCookieName: 'session-id',
    sessionHelpTitle: 'Como exportar o cookie?',
    sessionHelpContent:
      'Cookie de sessão do SiteStripe (opcional; usado em uma etapa futura para gerar links curtos amzn.to). Com a sessão logada em amazon.com.br, copie o valor do cookie "session-id".',
  },
  MAGALU: {
    kind: 'MAGALU',
    label: 'Magazine Luiza',
    description:
      'Identificador da loja no Magazine Você — usado para reescrever links de produtos do Magalu.',
    platformUrl: 'https://www.magazinevoce.com.br/',
    fields: [
      {
        key: 'affiliateTag',
        label: 'Nome da Loja (Magazine Você)',
        type: 'text',
        required: true,
        placeholder: 'Ex: minhaloja',
        helpTitle: 'Onde encontrar o nome da loja?',
        helpContent: 'O identificador da sua loja em magazinevoce.com.br/<sua-loja>.',
      },
    ],
    supportsSession: true,
    sessionCookieName: 'magalu_session',
    sessionHelpTitle: 'Como exportar o cookie?',
    sessionHelpContent:
      'Cookie de sessão do painel Magazine Você (opcional; usado em uma etapa futura para gerar links). Com a sessão logada, copie o valor do cookie de sessão.',
  },
};
