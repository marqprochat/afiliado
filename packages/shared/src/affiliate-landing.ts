import { z } from 'zod';

export const THEME_COLORS = ['rose', 'red', 'emerald', 'blue', 'violet', 'amber', 'cyan'] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const BUTTON_COLORS = [
  'emerald',
  'theme',
  'rose',
  'red',
  'blue',
  'violet',
  'amber',
  'cyan',
  'dark',
] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

export const RESERVED_AFFILIATE_SLUGS = new Set([
  'landpage',
  'login',
  'admin',
  'api',
  'dashboard',
  'afiliados',
  'ofertas',
  'g',
  'callbackml',
  'config',
  'lp',
  'produtos',
]);

const nullOrEmptyToNull = (val: unknown) => (typeof val === 'string' && val.trim() === '' ? null : val);

export interface AuraNicheItem {
  id: string;
  orderNumber: string;
  name: string;
  tagline: string;
  description: string;
  image: string;
  categoryBadge: string;
  dealsTodayCount: number;
  whatsappLink: string;
  popularItems: string[];
}

export interface AuraStepItem {
  number: string;
  title: string;
  description: string;
}

export interface AuraFaqItem {
  question: string;
  answer: string;
}

export const AURA_DEFAULT_HERO_IMAGE = '/assets/landing/hero-model.jpg';

export function formatGroupImage(src?: string | null, fallbackIndex: number = 0): string {
  if (!src || src.trim() === '') {
    const fallbackImages: readonly string[] = [
      '/assets/landing/niche-beleza.jpg',
      '/assets/landing/niche-bebe.png',
      '/assets/landing/niche-mercado.jpg',
      '/assets/landing/niche-casa.jpg',
    ];
    return fallbackImages[fallbackIndex % fallbackImages.length] ?? '/assets/landing/niche-beleza.jpg';
  }
  const clean = src.trim();
  if (
    clean.startsWith('data:') ||
    clean.startsWith('http://') ||
    clean.startsWith('https://') ||
    clean.startsWith('/')
  ) {
    return clean;
  }
  return `data:image/jpeg;base64,${clean}`;
}

export interface GroupLinkLike {
  id: string;
  slug: string;
  label: string;
  baseName?: string | null;
  customText?: string | null;
  groupDescription?: string | null;
  groupImageBase64?: string | null;
  displayOrder?: number | null;
  clickCount?: number | null;
}

export function mapGroupLinkToAuraNiche(link: GroupLinkLike, index: number): AuraNicheItem {
  const orderNumber = String(index + 1).padStart(2, '0');
  const name = (link.label || link.baseName || `Grupo ${orderNumber}`).trim();
  const description = (
    link.groupDescription ||
    link.customText ||
    'Entre no grupo oficial no WhatsApp para receber as melhores ofertas, cupons e bugs de preço selecionados diariamente.'
  ).trim();
  const image = formatGroupImage(link.groupImageBase64, index);
  const whatsappLink = `/g/${link.slug}`;
  const dealsTodayCount = Math.max(15, Math.min(99, Math.floor((link.clickCount || 0) / 8) + 20));

  return {
    id: link.slug || link.id,
    orderNumber,
    name,
    tagline: link.customText || link.groupDescription || '',
    description,
    image,
    categoryBadge: 'WhatsApp Oficial',
    dealsTodayCount,
    whatsappLink,
    popularItems: [
      'Ofertas com Menor Preço Histórico',
      'Cupons Exclusivos Testados',
      'Bugs e Erros de Preço',
      'Descontos Acima de 50% OFF',
    ],
  };
}

export const AURA_DEFAULT_NICHES: AuraNicheItem[] = [
  {
    id: 'beleza-cosmeticos',
    orderNumber: '01',
    name: 'BELEZA, COSMÉTICOS E CUIDADO',
    tagline: 'De cosméticos até cuidados íntimos com os maiores descontos',
    description: 'Grupo para produtos indispensáveis para mulheres, de cosméticos até cuidados íntimos!',
    image: '/assets/landing/niche-beleza.jpg',
    categoryBadge: 'Beleza & Cuidados',
    dealsTodayCount: 24,
    whatsappLink: '',
    popularItems: [
      'Perfumes Importados Originais',
      'Kits de Cabelo Wella & Truss',
      'Skincare & Protetor Solar',
      'Cuidados Íntimos & Higiene Feminina',
      'Maquiagens Virais do TikTok',
    ],
  },
  {
    id: 'bebe-crianca',
    orderNumber: '02',
    name: 'BEBÊ E CRIANÇA',
    tagline: 'De fraldas até alimentos, roupas, remédios e brinquedos',
    description: 'Tudo que precisa para seus pequenos, de fraldas até alimentos, roupas, remédios e brinquedos!',
    image: '/assets/landing/niche-bebe.png',
    categoryBadge: 'Maternidade & Pequenos',
    dealsTodayCount: 19,
    whatsappLink: '',
    popularItems: [
      'Mega Pacotes de Fraldas Pampers & Huggies',
      'Fórmulas & Alimentos Infantis',
      'Remédios & Puericultura',
      'Roupas & Conjuntinhos',
      'Brinquedos Educativos',
    ],
  },
  {
    id: 'mercado-despensa',
    orderNumber: '03',
    name: 'MERCADO & DESPENSA',
    tagline: 'Tudo que seu lar precisa para você e sua família',
    description: 'Tudo que seu lar precisa para você e sua família - Alimentos, cuidados pessoais, Limpeza e etc...',
    image: '/assets/landing/niche-mercado.jpg',
    categoryBadge: 'Supermercado & Limpeza',
    dealsTodayCount: 31,
    whatsappLink: '',
    popularItems: [
      'Sabão Líquido OMO & Ariel 5 Litros',
      'Cafés Gourmet Baggio & Nespresso',
      'Azeite de Oliva Extra Virgem',
      'Produtos de Limpeza & Papel Higiênico',
      'Alimentos Não Perecíveis',
    ],
  },
  {
    id: 'casa-decoracao',
    orderNumber: '04',
    name: 'CASA, DECORAÇÃO E UTENSILIOS',
    tagline: 'Tudo pra deixar seu lar com a sua cara',
    description: 'Tudo pra deixar seu lar com a sua cara. Eletrodomésticos, decorativos, utensílios e etc...',
    image: '/assets/landing/niche-casa.jpg',
    categoryBadge: 'Lar & Utilidades',
    dealsTodayCount: 22,
    whatsappLink: '',
    popularItems: [
      'Fritadeiras Sem Óleo Airfryer',
      'Aspiradores Robô Inteligentes',
      'Jogos de Panela Cerâmica',
      'Itens Decorativos & Mesa Posta',
      'Potes Herméticos & Organizadores',
    ],
  },
];

export const AURA_DEFAULT_STEPS: AuraStepItem[] = [
  {
    number: '01',
    title: 'Garimpo & Robôs 24h',
    description:
      'Nossa tecnologia aliada a curadores humanos rastreia quedas repentinas de preço, cupons escondidos e bugs de valor nas maiores lojas do país.',
  },
  {
    number: '02',
    title: 'Verificação de Autenticidade',
    description:
      'Checamos o histórico de preços dos últimos 6 meses para garantir que a promoção é real e que a loja vendedora possui reputação máxima.',
  },
  {
    number: '03',
    title: 'Aviso Direto Sem Conversa Paralela',
    description:
      'O link com cupom mastigado chega no seu grupo silencioso. Você clica, aplica e compra antes do estoque de desconto acabar.',
  },
];

export const AURA_DEFAULT_FAQS: AuraFaqItem[] = [
  {
    question: 'Os grupos no WhatsApp são 100% gratuitos?',
    answer:
      'Sim, totalmente gratuitos! Você não paga nada para entrar nem para permanecer nos grupos do WhatsApp. Nosso objetivo é compartilhar as melhores oportunidades de economia que garimpamos diariamente.',
  },
  {
    question: 'O grupo é silencioso ou fica chegando mensagem de conversa o dia todo?',
    answer:
      'Todos os nossos grupos no WhatsApp são 100% silenciosos e fechados. Apenas a equipe de administradores publica os links de promoções, cupons e bugs de preço. Seu celular não vai travar com conversas paralelas nem bom-dia/boa-noite.',
  },
  {
    question: 'Os links e cupons postados são seguros e confiáveis?',
    answer:
      'Absolutamente! Testamos cada promoção antes de publicar e divulgamos apenas lojas oficiais com selo de verificação e alta reputação, como Amazon, Mercado Livre Oficial, Shopee Oficial, Magazine Luiza, Sephora e farmácias credenciadas.',
  },
  {
    question: 'Posso participar de mais de um grupo de nicho ao mesmo tempo?',
    answer:
      'Com certeza! Você pode entrar nos grupos de WhatsApp dos nichos que mais consome (por exemplo, Beleza + Bebê & Criança) ou entrar no grupo geral que reúne os destaques de todas as categorias.',
  },
  {
    question: 'Como faço para aproveitar um preço baixo antes que acabe o estoque?',
    answer:
      'Assim que entrar no grupo, fixe o grupo no topo do seu WhatsApp e ative as notificações. Ofertas com mais de 50% de desconto ou bugs de preço costumam esgotar em poucos minutos!',
  },
];

export const nicheItemSchema = z.object({
  id: z.string(),
  orderNumber: z.string().default('01'),
  name: z.string().min(1),
  tagline: z.string().optional().default(''),
  description: z.string().min(1),
  image: z.string().min(1),
  categoryBadge: z.string().default('Geral'),
  dealsTodayCount: z.number().int().nonnegative().default(20),
  whatsappLink: z.string().default(''),
  popularItems: z.array(z.string()).default([]),
});

export const stepItemSchema = z.object({
  number: z.string(),
  title: z.string(),
  description: z.string(),
});

export const faqItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const affiliateLandingUpdateSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Slug deve ter pelo menos 3 caracteres')
    .max(50, 'Slug deve ter no máximo 50 caracteres')
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e traços')
    .refine((s) => !RESERVED_AFFILIATE_SLUGS.has(s), {
      message: 'Este slug é reservado pelo sistema',
    }),
  enabled: z.boolean().default(true),
  title: z.preprocess(nullOrEmptyToNull, z.string().trim().max(100).nullable().optional()),
  authorName: z.string().trim().min(2, 'Nome deve ter pelo menos 2 caracteres').max(80),
  authorBadge: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  authorBio: z.preprocess(nullOrEmptyToNull, z.string().trim().max(600).nullable().optional()),
  authorImage: z.preprocess(nullOrEmptyToNull, z.string().trim().nullable().optional()),
  logoText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  themeColor: z.enum(THEME_COLORS).default('rose'),
  themeMode: z.enum(THEME_MODES).default('light'),
  buttonColor: z.enum(BUTTON_COLORS).default('emerald'),

  // Dobra 1: Hero
  heroImage: z.preprocess(nullOrEmptyToNull, z.string().trim().nullable().optional()),
  badgeText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(100).nullable().optional()),
  headline: z.preprocess(nullOrEmptyToNull, z.string().trim().max(250).nullable().optional()),
  subheadline: z.preprocess(nullOrEmptyToNull, z.string().trim().max(500).nullable().optional()),
  floatingBadgeText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(100).nullable().optional()),
  ctaButtonText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(80).nullable().optional()),
  reassuranceText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(300).nullable().optional()),
  whatsappGeneralUrl: z.preprocess(nullOrEmptyToNull, z.string().trim().nullable().optional()),

  // Estatísticas (legado)
  stat1Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat1Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  stat2Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat2Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  stat3Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat3Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  stat4Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat4Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),

  // Dobra Como Funciona
  howItWorksTitle: z.preprocess(nullOrEmptyToNull, z.string().trim().max(150).nullable().optional()),
  howItWorksSubtitle: z.preprocess(nullOrEmptyToNull, z.string().trim().max(300).nullable().optional()),
  howItWorksSteps: z.array(stepItemSchema).nullable().optional(),

  // Dobra FAQ
  faqTitle: z.preprocess(nullOrEmptyToNull, z.string().trim().max(150).nullable().optional()),
  faqSubtitle: z.preprocess(nullOrEmptyToNull, z.string().trim().max(300).nullable().optional()),
  faqItems: z.array(faqItemSchema).nullable().optional(),
  faqBannerTitle: z.preprocess(nullOrEmptyToNull, z.string().trim().max(150).nullable().optional()),
  faqBannerText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(300).nullable().optional()),
  faqBannerButtonText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(60).nullable().optional()),

  // Nichos customizados
  customNiches: z.array(nicheItemSchema).nullable().optional(),

  // Rodapé
  footerText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(300).nullable().optional()),

  // Redes sociais
  youtubeUrl: z.preprocess(nullOrEmptyToNull, z.string().trim().nullable().optional()),
  instagramUrl: z.preprocess(nullOrEmptyToNull, z.string().trim().nullable().optional()),
  telegramUrl: z.preprocess(nullOrEmptyToNull, z.string().trim().nullable().optional()),

  // Seções visíveis
  showBenefits: z.boolean().default(true),
  showAuthority: z.boolean().default(true),
  showCategories: z.boolean().default(true),
  showFaq: z.boolean().default(true),
  showHowItWorks: z.boolean().default(true),
  showNiches: z.boolean().default(true),
});

export type AffiliateLandingInput = z.infer<typeof affiliateLandingUpdateSchema>;
