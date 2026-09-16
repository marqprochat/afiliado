import { z } from 'zod';
import { MARKETPLACE_KINDS, MEDIA_MODES, MIRROR_LOG_STATUSES, MIRROR_MODES } from './enums';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'formato HH:mm');

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const settingsUpdateSchema = z.object({
  window: z
    .object({ startTime: hhmm, endTime: hhmm, timezone: z.string().min(1), enabled: z.boolean() })
    .partial()
    .optional(),
  queueLimit: z.number().int().min(1).max(5000).optional(),
  globalRateLimitPerMin: z.number().int().min(1).max(60).optional(),
  subIdPattern: z.string().min(1).max(50).optional(),
});

export const waSessionCreateSchema = z.object({ label: z.string().min(1).max(60) });

export const waConnectSchema = z
  .object({
    mode: z.enum(['qr', 'pair']),
    phone: z
      .string()
      .regex(/^\d{10,15}$/)
      .optional(),
  })
  .refine((v) => v.mode !== 'pair' || !!v.phone, {
    message: 'phone obrigatório no modo pair',
    path: ['phone'],
  });

export const marketplaceKindParam = z.enum(MARKETPLACE_KINDS);
export const marketplaceUpdateSchema = z.object({
  appId: z.string().min(1).optional(),
  secret: z.string().min(1).optional(),
  affiliateTag: z.string().max(100).optional(),
  mattWord: z.string().min(1).max(60).optional(),
  mattTool: z
    .string()
    .regex(/^\d{1,12}$/, 'matt_tool deve ser numérico')
    .optional(),
});

export const mirrorRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sessionId: z.string().min(1),
    sourceJids: z.array(z.string().min(1)).min(1),
    targetJids: z.array(z.string().min(1)).min(1),
    mode: z.enum(MIRROR_MODES).default('CLONE'),
    mediaMode: z.enum(MEDIA_MODES).default('PREVIEW'),
    templateId: z.string().min(1).optional(),
    dedupHours: z.number().int().min(1).max(168).default(12),
    enabled: z.boolean().default(true),
  })
  .refine((r) => !r.sourceJids.some((j) => r.targetJids.includes(j)), {
    message: 'um grupo não pode ser origem e destino ao mesmo tempo',
    path: ['targetJids'],
  });
export type MirrorRuleBody = z.infer<typeof mirrorRuleSchema>;

export const mirrorLogsQuerySchema = z.object({
  ruleId: z.string().min(1).optional(),
  status: z.enum(MIRROR_LOG_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const productsImportSchema = z.object({ urls: z.array(z.string().url()).min(1).max(200) });
export const queueAddSchema = z.object({ productIds: z.array(z.string().min(1)).min(1) });
export const queueSelectSchema = z.object({
  ids: z.array(z.string().min(1)),
  selected: z.boolean(),
});

export const templateSchema = z.object({
  name: z.string().min(1).max(60),
  body: z.string().min(1).max(4000),
  isDefault: z.boolean().optional(),
});
export const templatePreviewSchema = z.object({ body: z.string().min(1).max(4000) });

export const batchCreateSchema = z
  .object({
    name: z.string().min(1).max(80),
    sessionId: z.string().min(1),
    templateId: z.string().min(1),
    groupJids: z.array(z.string().min(1)).min(1),
    intervalMin: z.number().int().min(1).max(1440),
    mediaMode: z.enum(MEDIA_MODES).default('IMAGE'),
    shuffled: z.boolean().default(false),
    /** Se omitido, usa todos os QueueItem selecionados e PENDING. */
    productIds: z.array(z.string().min(1)).optional(),
  })
  .transform((data) => ({
    ...data,
    productIds: data.productIds ?? undefined,
  }));

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type ApiTokenCreateBody = z.infer<typeof apiTokenCreateSchema>;

export const extensionCaptureSchema = z.object({
  url: z.string().url(),
  marketplaceKind: z.enum(MARKETPLACE_KINDS),
  title: z.string().min(1).max(500).optional(),
  price: z.number().positive().optional(),
  originalPrice: z.number().positive().optional(),
  images: z.array(z.string().url()).optional(),
  couponCode: z.string().max(60).optional(),
  couponValue: z.number().positive().optional(),
  shipping: z.enum(['NONE', 'FREE', 'FULL', 'UNKNOWN']).optional(),
  flashSaleEndsAt: z.string().datetime().optional(),
  affiliateUrl: z.string().url().optional(),
});
export type ExtensionCaptureBody = z.infer<typeof extensionCaptureSchema>;

export const extensionSessionSchema = z.object({
  // Só o Mercado Livre usa sessão logada (gerador oficial meli.la)
  marketplaceKind: z.literal('MERCADOLIVRE'),
  cookies: z
    .record(z.string().min(1).max(64), z.string().max(4096))
    .refine((c) => Object.keys(c).length > 0 && Object.keys(c).length <= 80, {
      message: 'Informe entre 1 e 80 cookies',
    }),
});
export type ExtensionSessionBody = z.infer<typeof extensionSessionSchema>;

export const marketplaceSessionSchema = z.object({
  cookie: z.string().min(1).max(20000),
});
export type MarketplaceSessionBody = z.infer<typeof marketplaceSessionSchema>;

export type LoginBody = z.infer<typeof loginSchema>;
export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>;
export type WaSessionCreateBody = z.infer<typeof waSessionCreateSchema>;
export type WaConnectBody = z.infer<typeof waConnectSchema>;
export type MarketplaceUpdateBody = z.infer<typeof marketplaceUpdateSchema>;
export type ProductsImportBody = z.infer<typeof productsImportSchema>;
export type QueueAddBody = z.infer<typeof queueAddSchema>;
export type QueueSelectBody = z.infer<typeof queueSelectSchema>;
export type TemplateBody = z.infer<typeof templateSchema>;
export type TemplatePreviewBody = z.infer<typeof templatePreviewSchema>;
export type BatchCreateBody = z.infer<typeof batchCreateSchema>;
