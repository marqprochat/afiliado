import { z } from 'zod';
import { MARKETPLACE_KINDS, MEDIA_MODES, MIRROR_LOG_STATUSES, MIRROR_MODES, SHIPPINGS } from './enums';

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

const waPhone = z.string().regex(/^\d{10,15}$/, 'telefone deve ter só dígitos (DDI+DDD+número)');

export const groupCreateSchema = z.object({
  subject: z.string().trim().min(1).max(25),
  participants: z.array(waPhone).min(1).max(256),
});

export const groupParticipantsSchema = z.object({
  action: z.enum(['add', 'remove', 'promote', 'demote']),
  participants: z.array(waPhone).min(1).max(256),
});

export const groupSettingsSchema = z
  .object({
    subject: z.string().trim().min(1).max(25).optional(),
    description: z.string().trim().max(2048).optional(),
    announceOnly: z.boolean().optional(),
  })
  .refine((v) => v.subject !== undefined || v.description !== undefined || v.announceOnly !== undefined, {
    message: 'informe ao menos um campo para atualizar',
  });

export const groupInviteSchema = z.object({ revoke: z.boolean().default(false) });

export const telegramBotCreateSchema = z.object({
  label: z.string().trim().min(1).max(60),
  token: z
    .string()
    .trim()
    .regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'token do BotFather inválido'),
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
  amazonClientId: z.string().min(1).optional(),
  amazonClientSecret: z.string().min(1).optional(),
  publisherId: z.string().min(1).max(40).optional(),
  datafeedApiKey: z.string().min(1).max(200).optional(),
  feedIds: z.array(z.string().min(1).max(40)).max(50).optional(),
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

// Metadados opcionais já extraídos pela extensão a partir do DOM de uma página de busca/listagem
// (mesma técnica usada pelo botão de captura única) — quando presentes, o backend pula o scraping
// (que para ML/Magalu esbarra em bloqueio anti-bot) e usa os dados diretamente.
export const productsImportItemSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(500).optional(),
  price: z.number().nonnegative().optional(),
  originalPrice: z.number().nonnegative().optional(),
  discountPct: z.number().int().min(0).max(100).optional(),
  images: z.array(z.string().url()).optional(),
  shipping: z.enum(SHIPPINGS).optional(),
  couponCode: z.string().max(60).optional(),
});
export type ProductsImportItem = z.infer<typeof productsImportItemSchema>;

export const productsImportSchema = z
  .object({
    urls: z.array(z.string().url()).min(1).max(200).optional(),
    items: z.array(productsImportItemSchema).min(1).max(200).optional(),
  })
  .refine((v) => (v.urls && v.urls.length > 0) || (v.items && v.items.length > 0), {
    message: 'Informe urls ou items',
  });
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
    telegramChatIds: z.array(z.string().min(1)).default([]),
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
  title: z.string().min(1).max(500).nullish(),
  price: z.number().positive().nullish(),
  originalPrice: z.number().positive().nullish(),
  discountPct: z.number().int().min(1).max(100).nullish(),
  images: z.array(z.string().url()).nullish(),
  couponCode: z.string().max(60).nullish(),
  couponValue: z.number().positive().nullish(),
  shipping: z.enum(['NONE', 'FREE', 'FULL', 'UNKNOWN']).nullish(),
  flashSaleEndsAt: z.string().datetime().nullish(),
  affiliateUrl: z.string().url().nullish(),
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
export type GroupCreateBody = z.infer<typeof groupCreateSchema>;
export type GroupParticipantsBody = z.infer<typeof groupParticipantsSchema>;
export type GroupSettingsBody = z.infer<typeof groupSettingsSchema>;
export type GroupInviteBody = z.infer<typeof groupInviteSchema>;
export type TelegramBotCreateBody = z.infer<typeof telegramBotCreateSchema>;
export type MarketplaceUpdateBody = z.infer<typeof marketplaceUpdateSchema>;
export type ProductsImportBody = z.infer<typeof productsImportSchema>;
export type QueueAddBody = z.infer<typeof queueAddSchema>;
export type QueueSelectBody = z.infer<typeof queueSelectSchema>;
export type TemplateBody = z.infer<typeof templateSchema>;
export type TemplatePreviewBody = z.infer<typeof templatePreviewSchema>;
export type BatchCreateBody = z.infer<typeof batchCreateSchema>;
