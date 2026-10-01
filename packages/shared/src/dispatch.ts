import { z } from 'zod';

export const DISPATCH_MODES = ['now', 'queue'] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

/** Mesmo teto do corpo de template (`templateSchema.body`). */
export const MANUAL_TEXT_MAX = 4000;

const dispatchTargets = {
  sessionId: z.string().min(1),
  groupJids: z.array(z.string().min(1)).min(1),
  telegramChatIds: z.array(z.string().min(1)).default([]),
  mode: z.enum(DISPATCH_MODES),
  /** Só vale em `mode: 'queue'`. */
  intervalMin: z.number().int().min(1).max(1440).default(10),
};

/** "Enviar agora" ocupa o worker (um job por vez): acima disso, só pela fila. */
export const MAX_DISPATCH_NOW = 20;

export const couponDispatchSchema = z
  .object({
    couponIds: z.array(z.string().min(1)).min(1).max(200),
    templateId: z.string().min(1),
    ...dispatchTargets,
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'now' && v.couponIds.length > MAX_DISPATCH_NOW) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['couponIds'],
        message: `Envio imediato aceita no máximo ${MAX_DISPATCH_NOW} cupons; use 'Colocar na fila'`,
      });
    }
  });
export type CouponDispatchBody = z.infer<typeof couponDispatchSchema>;

export const manualSendSchema = z.object({
  text: z.string().trim().min(1).max(MANUAL_TEXT_MAX),
  imageUrl: z
    .string()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'A imagem deve ser uma URL http(s)')
    .optional(),
  ...dispatchTargets,
});
export type ManualSendBody = z.infer<typeof manualSendSchema>;

export interface DispatchSkipped {
  id: string;
  code: string | null;
  /** 'invalid' | 'expired' | 'empty-code' | 'not-found' */
  reason: string;
}

export interface DispatchResult {
  batchId: string;
  name: string;
  mode: DispatchMode;
  itemCount: number;
  firstRunAt: string;
  skipped: DispatchSkipped[];
}
