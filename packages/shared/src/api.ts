import { z } from 'zod';
import { MARKETPLACE_KINDS, MEDIA_MODES } from './enums';

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

export type LoginBody = z.infer<typeof loginSchema>;
export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>;
export type BatchCreateBody = z.infer<typeof batchCreateSchema>;
