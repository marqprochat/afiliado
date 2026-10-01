import { z } from 'zod';

export const AI_TONES = ['empolgado', 'divertido', 'urgente', 'sofisticado'] as const;
export const AI_EMOJI_LEVELS = ['poucos', 'medio', 'muitos'] as const;
export type AiTone = (typeof AI_TONES)[number];
export type AiEmojiLevel = (typeof AI_EMOJI_LEVELS)[number];

export const AI_DEFAULTS = {
  enabled: false,
  baseUrl: '',
  model: '',
  extraInstructions: '',
  tone: 'empolgado' as AiTone,
  emojiLevel: 'medio' as AiEmojiLevel,
  maxChars: 140,
  temperature: 0.9,
};

/** Valor persistido em Setting(key='ai'). A chave fica criptografada (base64 de encryptJson). */
export interface StoredAiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  encryptedApiKey?: string;
  extraInstructions?: string;
  tone?: AiTone;
  emojiLevel?: AiEmojiLevel;
  maxChars?: number;
  temperature?: number;
}

/** Resposta de GET/PUT /settings/ai — nunca contém a apiKey. */
export interface PublicAiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  extraInstructions: string;
  tone: AiTone;
  emojiLevel: AiEmojiLevel;
  maxChars: number;
  temperature: number;
}

const fields = {
  enabled: z.boolean(),
  baseUrl: z.string().trim().max(300),
  model: z.string().trim().max(120),
  apiKey: z.string().max(500),
  extraInstructions: z.string().max(500),
  tone: z.enum(AI_TONES),
  emojiLevel: z.enum(AI_EMOJI_LEVELS),
  maxChars: z.number().int().min(40).max(300),
  temperature: z.number().min(0).max(2),
};

export const aiSettingsUpdateSchema = z.object(fields).partial();
export const aiTestSchema = z.object({ ...fields, productId: z.string().min(1) }).partial();

export type AiSettingsUpdateBody = z.infer<typeof aiSettingsUpdateSchema>;
export type AiTestBody = z.infer<typeof aiTestSchema>;
