import { z } from 'zod';
import { GROUP_LINK_STATUSES, GROUP_TEXT_POSITIONS, type GroupTextPosition } from './enums';

export const RESERVED_SLUGS = new Set([
  'api',
  'login',
  'admin',
  'g',
  'app',
  'dashboard',
  'settings',
  'auth',
  'public',
  'static',
  'assets',
  'favicon.ico',
  'config',
  'webhook',
  'callbackml',
  'grupos',
  'produtos',
  'enviar',
  'espelhamento',
  'automacoes',
  'afiliados',
  'marketplaces',
  'links-grupos',
  'link-fixo',
]);

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  if (!slug || typeof slug !== 'string') return false;
  const normalized = slug.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 40) return false;
  if (!SLUG_REGEX.test(normalized)) return false;
  if (RESERVED_SLUGS.has(normalized)) return false;
  return true;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function countGraphemes(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const _ of segmenter.segment(text)) {
    count++;
  }
  return count;
}

export function sliceGraphemes(text: string, maxGraphemes: number): string {
  if (!text || maxGraphemes <= 0) return '';
  const segments: string[] = [];
  for (const s of segmenter.segment(text)) {
    if (segments.length >= maxGraphemes) break;
    segments.push(s.segment);
  }
  return segments.join('');
}

/**
 * Sanitiza texto de grupo para WhatsApp:
 * 1. Normaliza em Unicode NFC
 * 2. Remove caracteres de controle (\p{Cc}, \r, \n, etc.) e caracteres de formatação (\p{Cf}),
 *    mas PRESERVA explicitamente ZWJ (\u200D) e VS16 (\uFE0F) para emojis compostos.
 * 3. Colapsa espaços repetidos e executa trim.
 */
export function sanitizeGroupText(text: string): string {
  if (!text) return '';
  let normalized = text.normalize('NFC');
  // Remove caracteres de controle (\r, \n, \x00-\x1F, \x7F-\x9F, \p{Cc})
  normalized = normalized.replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, '');
  // Remove caracteres de controle e formato unicode exceto ZWJ (U+200D) e VS16 (U+FE0F)
  normalized = normalized.replace(/(?![\u200D\uFE0F])[\p{Cc}\p{Cf}]/gu, '');
  // Colapsa espaços múltiplos e dá trim
  return normalized.replace(/\s+/g, ' ').trim();
}

export interface BuildGroupNameOptions {
  baseName: string;
  customText?: string;
  textPosition?: GroupTextPosition;
  numberPrefix?: string;
  number: number;
  maxLength?: number;
}

/**
 * Constrói o nome final do grupo gerenciado.
 * Formato:
 * - PREFIX: "[customText ]<baseName> <numberPrefix><n>"
 * - SUFFIX: "<baseName> <numberPrefix><n>[ customText]"
 *
 * Se o comprimento em grafemas ultrapassar maxLength (padrão 100 caracteres),
 * corta SOMENTE o baseName em fronteira exata de grafema, nunca cortando o número ou customText.
 */
export function buildGroupName(opts: BuildGroupNameOptions): string {
  const maxLength = opts.maxLength ?? 100;
  const cleanBase = sanitizeGroupText(opts.baseName || '');
  const cleanCustom = opts.customText ? sanitizeGroupText(opts.customText) : '';
  const numPrefix = opts.numberPrefix !== undefined ? sanitizeGroupText(opts.numberPrefix) : '#';
  const numPart = `${numPrefix}${opts.number}`.trim();
  const position = opts.textPosition ?? 'PREFIX';

  // Componentes fixos que NUNCA devem ser cortados
  const numGraphemes = countGraphemes(numPart);
  const customGraphemes = cleanCustom ? countGraphemes(cleanCustom) : 0;

  // Calcula quanto espaço resta para o baseName
  // Se cleanCustom existe:
  // PREFIX: cleanCustom + " " + baseName + " " + numPart -> espaços extras = 2 (se baseName existir) ou 1
  // SUFFIX: baseName + " " + numPart + " " + cleanCustom -> espaços extras = 2 (se baseName existir) ou 1
  // Sem cleanCustom: baseName + " " + numPart -> espaços extras = 1
  let fixedGraphemeCount = numGraphemes;
  if (cleanCustom) {
    // 1 espaço entre base e num, 1 espaço entre custom e o resto
    fixedGraphemeCount += customGraphemes + 2;
  } else {
    // 1 espaço entre base e num
    fixedGraphemeCount += 1;
  }

  const availableForBase = Math.max(0, maxLength - fixedGraphemeCount);
  let finalBase = cleanBase;
  if (countGraphemes(cleanBase) > availableForBase) {
    finalBase = sliceGraphemes(cleanBase, availableForBase).trim();
  }

  let result = '';
  if (cleanCustom) {
    if (position === 'PREFIX') {
      result = finalBase ? `${cleanCustom} ${finalBase} ${numPart}` : `${cleanCustom} ${numPart}`;
    } else {
      result = finalBase ? `${finalBase} ${numPart} ${cleanCustom}` : `${numPart} ${cleanCustom}`;
    }
  } else {
    result = finalBase ? `${finalBase} ${numPart}` : numPart;
  }

  return sanitizeGroupText(result);
}

const waPhone = z.string().regex(/^\d{10,15}$/, 'telefone deve ter só dígitos (DDI+DDD+número)');

export const groupLinkSlugSchema = z
  .string()
  .trim()
  .min(3, 'Slug deve ter no mínimo 3 caracteres')
  .max(40, 'Slug deve ter no máximo 40 caracteres')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug deve conter apenas letras minúsculas, números e hífens',
  )
  .refine((s) => !RESERVED_SLUGS.has(s.toLowerCase()), { message: 'Slug reservado pelo sistema' });

export const groupImageBase64Schema = z
  .string()
  .refine(
    (val) => {
      if (!val) return true;
      return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(val);
    },
    { message: 'Formato de imagem inválido. Use JPEG, PNG ou WebP em data URL base64.' },
  )
  .refine(
    (val) => {
      if (!val) return true;
      // Aceita até ~400KB base64 (o que dá ~300KB de imagem)
      return val.length <= 600 * 1024;
    },
    { message: 'A imagem deve ter no máximo 300KB' },
  )
  .or(z.literal(''))
  .nullable()
  .optional();

export const groupLinkCreateSchema = z.object({
  sessionId: z.string().min(1, 'Sessão do WhatsApp é obrigatória'),
  slug: groupLinkSlugSchema,
  label: z.string().trim().min(1, 'Rótulo é obrigatório').max(60),
  baseName: z.string().trim().min(1, 'Nome base é obrigatório').max(100),
  customText: z.string().trim().max(100).optional().default(''),
  textPosition: z.enum(GROUP_TEXT_POSITIONS).default('PREFIX'),
  numberPrefix: z.string().max(10).default('#'),
  startNumber: z.coerce.number().int().min(1).default(1),
  memberLimit: z.coerce.number().int().min(2).max(1024).default(1000),
  rotateMargin: z.coerce.number().int().min(1).max(100).default(20),
  maxRotationsPerHour: z.coerce.number().int().min(1).max(60).default(3),
  groupDescription: z.string().trim().max(2048).nullable().optional(),
  announceOnly: z.boolean().default(false),
  seedParticipants: z.array(waPhone).max(50).default([]),
  groupImageBase64: groupImageBase64Schema,
  fallbackUrl: z
    .string()
    .trim()
    .url('URL de fallback inválida')
    .or(z.literal(''))
    .nullable()
    .optional(),
  initialGroupJid: z.string().trim().optional(),
});

export const groupLinkUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  baseName: z.string().trim().min(1).max(100).optional(),
  customText: z.string().trim().max(100).optional(),
  textPosition: z.enum(GROUP_TEXT_POSITIONS).optional(),
  numberPrefix: z.string().max(10).optional(),
  memberLimit: z.coerce.number().int().min(2).max(1024).optional(),
  rotateMargin: z.coerce.number().int().min(1).max(100).optional(),
  maxRotationsPerHour: z.coerce.number().int().min(1).max(60).optional(),
  groupDescription: z.string().trim().max(2048).nullable().optional(),
  announceOnly: z.boolean().optional(),
  seedParticipants: z.array(waPhone).max(50).optional(),
  groupImageBase64: groupImageBase64Schema,
  fallbackUrl: z
    .string()
    .trim()
    .url('URL de fallback inválida')
    .or(z.literal(''))
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
  status: z.enum(GROUP_LINK_STATUSES).optional(),
  displayOrder: z.coerce.number().int().optional(),
});

export const groupLinkReorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

export const groupLinkRotateSchema = z.object({
  reason: z.enum(['manual', 'threshold', 'orphaned', 'initial']).default('manual'),
});
