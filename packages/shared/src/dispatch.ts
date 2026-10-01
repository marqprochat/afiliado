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

export const MANUAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MANUAL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ManualImageType = (typeof MANUAL_IMAGE_TYPES)[number];

export function detectImageSignature(bytes: Uint8Array): ManualImageType | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export const MANUAL_IMAGE_MAX_BASE64_LENGTH = Math.ceil((MANUAL_IMAGE_MAX_BYTES * 4) / 3) + 500;

export function decodeBase64(base64: string): Uint8Array {
  const clean = base64.replace(/^data:image\/[a-zA-Z]+;base64,/, '').trim();
  if (!clean || !/^[A-Za-z0-9+/=\s]*$/.test(clean) || clean.length % 4 === 1) {
    throw new Error('Base64 inválido');
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(clean, 'base64');
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const manualSendSchema = z
  .object({
    text: z.string().trim().min(1).max(MANUAL_TEXT_MAX),
    imageUrl: z
      .string()
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), 'A imagem deve ser uma URL http(s)')
      .optional(),
    imageData: z.string().optional(),
    imageType: z.enum(MANUAL_IMAGE_TYPES).optional(),
    ...dispatchTargets,
  })
  .superRefine((v, ctx) => {
    const hasUrl = Boolean(v.imageUrl);
    const hasData = Boolean(v.imageData);
    const hasType = Boolean(v.imageType);

    if (hasUrl && (hasData || hasType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['imageData'],
        message: 'Informe uma URL ou envie um arquivo, não ambos',
      });
      return;
    }

    if (hasData && !hasType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['imageType'],
        message: 'Tipo de imagem obrigatório ao enviar arquivo',
      });
      return;
    }

    if (hasType && !hasData) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['imageData'],
        message: 'Dados da imagem obrigatórios ao informar tipo',
      });
      return;
    }

    if (hasData && hasType) {
      const raw = v.imageData!;
      if (raw.length > MANUAL_IMAGE_MAX_BASE64_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['imageData'],
          message: 'A imagem deve ter no máximo 5 MB',
        });
        return;
      }
      try {
        const bytes = decodeBase64(raw);
        if (bytes.length > MANUAL_IMAGE_MAX_BYTES) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['imageData'],
            message: 'A imagem deve ter no máximo 5 MB',
          });
          return;
        }
        const detected = detectImageSignature(bytes);
        if (!detected || detected !== v.imageType) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['imageData'],
            message: 'Arquivo de imagem corrompido ou formato incompatível',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['imageData'],
          message: 'Base64 de imagem inválido',
        });
      }
    }
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
