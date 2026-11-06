import { z } from 'zod';

export const THEME_COLORS = ['red', 'emerald', 'blue', 'violet', 'amber', 'rose', 'cyan'] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

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
  themeColor: z.enum(THEME_COLORS).default('red'),
  headline: z.preprocess(nullOrEmptyToNull, z.string().trim().max(250).nullable().optional()),
  subheadline: z.preprocess(nullOrEmptyToNull, z.string().trim().max(500).nullable().optional()),
  ctaButtonText: z.preprocess(nullOrEmptyToNull, z.string().trim().max(60).nullable().optional()),
  stat1Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat1Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  stat2Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat2Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  stat3Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat3Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  stat4Value: z.preprocess(nullOrEmptyToNull, z.string().trim().max(30).nullable().optional()),
  stat4Label: z.preprocess(nullOrEmptyToNull, z.string().trim().max(50).nullable().optional()),
  youtubeUrl: z.preprocess(nullOrEmptyToNull, z.string().trim().url('URL inválida').nullable().optional()),
  instagramUrl: z.preprocess(nullOrEmptyToNull, z.string().trim().url('URL inválida').nullable().optional()),
  telegramUrl: z.preprocess(nullOrEmptyToNull, z.string().trim().url('URL inválida').nullable().optional()),
  showBenefits: z.boolean().default(true),
  showAuthority: z.boolean().default(true),
  showCategories: z.boolean().default(true),
  showFaq: z.boolean().default(true),
});

export type AffiliateLandingInput = z.infer<typeof affiliateLandingUpdateSchema>;
