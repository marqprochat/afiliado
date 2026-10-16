import type { MarketplaceKind } from '@afilados/shared';

export const AFFILIATE_SUBID_FIELDS: Record<MarketplaceKind, { label: string; help: string }> = {
  SHOPEE: {
    label: 'SubID',
    help: 'Identifica as vendas do afiliado na Shopee. Só letras e números.',
  },
  ALIEXPRESS: {
    label: 'SubID',
    help: 'Enviado como sub_id nos links do AliExpress. Só letras e números.',
  },
  AWIN: { label: 'SubID', help: 'Enviado como clickref nos links da Awin. Só letras e números.' },
  AMAZON: {
    label: 'Tracking ID',
    help: 'Tracking ID criado na conta Amazon do administrador (ex.: nome-20).',
  },
  MERCADOLIVRE: {
    label: 'Etiqueta',
    help: 'Etiqueta de afiliado criada na conta do administrador.',
  },
  MAGALU: {
    label: 'Loja',
    help: 'Nome da loja no Magazine Você. Em branco, usa a loja do administrador.',
  },
};
