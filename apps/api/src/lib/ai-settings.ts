import { decryptJson, encryptJson, type Product, type TenantClient } from '@afilados/db';
import type { AiCtaConfig } from '@afilados/core';
import {
  AI_DEFAULTS,
  ApiError,
  type AiSettingsUpdateBody,
  type ProductData,
  type PublicAiSettings,
  type StoredAiConfig,
} from '@afilados/shared';

const AI_KEY = 'ai';

export async function loadStoredAi(db: TenantClient): Promise<StoredAiConfig> {
  const row = await db.setting.findFirst({ where: { key: AI_KEY } });
  return {
    enabled: false,
    baseUrl: '',
    model: '',
    ...((row?.value as Partial<StoredAiConfig> | null) ?? {}),
  };
}

export async function saveStoredAi(db: TenantClient, tenantId: string, value: StoredAiConfig) {
  await db.setting.upsert({
    where: { tenantId_key: { tenantId, key: AI_KEY } },
    update: { value: value as object },
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    create: { key: AI_KEY, value: value as object },
  });
}

function readApiKey(stored: StoredAiConfig): string | null {
  if (!stored.encryptedApiKey) return null;
  try {
    return decryptJson<{ apiKey: string }>(Buffer.from(stored.encryptedApiKey, 'base64')).apiKey;
  } catch {
    return null;
  }
}

export function toPublicAi(s: StoredAiConfig): PublicAiSettings {
  const key = readApiKey(s);
  return {
    enabled: s.enabled,
    baseUrl: s.baseUrl,
    model: s.model,
    hasApiKey: Boolean(s.encryptedApiKey),
    apiKeyHint: s.encryptedApiKey ? `••••${key ? key.slice(-4) : ''}` : null,
    extraInstructions: s.extraInstructions ?? AI_DEFAULTS.extraInstructions,
    tone: s.tone ?? AI_DEFAULTS.tone,
    emojiLevel: s.emojiLevel ?? AI_DEFAULTS.emojiLevel,
    maxChars: s.maxChars ?? AI_DEFAULTS.maxChars,
    temperature: s.temperature ?? AI_DEFAULTS.temperature,
  };
}

/** Aplica um patch parcial; `apiKey` vazia/ausente mantém a chave atual. */
export function applyPatch(stored: StoredAiConfig, patch: AiSettingsUpdateBody): StoredAiConfig {
  const { apiKey, ...rest } = patch;
  const next: StoredAiConfig = { ...stored };
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v;
  }
  if (apiKey && apiKey.trim()) {
    next.encryptedApiKey = encryptJson({ apiKey: apiKey.trim() }).toString('base64');
  }
  return next;
}

export function assertComplete(c: StoredAiConfig, what: string) {
  if (!c.baseUrl || !c.model || !c.encryptedApiKey) {
    throw ApiError.validation(`${what}: informe Base URL, Modelo e API key`);
  }
}

export function toCtaConfig(c: StoredAiConfig): AiCtaConfig {
  const apiKey = readApiKey(c);
  if (!apiKey) throw ApiError.validation('API key ausente ou ilegível; informe-a de novo');
  return {
    baseUrl: c.baseUrl,
    apiKey,
    model: c.model,
    extraInstructions: c.extraInstructions ?? AI_DEFAULTS.extraInstructions,
    tone: c.tone ?? AI_DEFAULTS.tone,
    emojiLevel: c.emojiLevel ?? AI_DEFAULTS.emojiLevel,
    maxChars: c.maxChars ?? AI_DEFAULTS.maxChars,
    temperature: c.temperature ?? AI_DEFAULTS.temperature,
  };
}

export const SAMPLE_PRODUCT: ProductData = {
  source: 'SHOPEE',
  title: 'Fone de Ouvido Bluetooth TWS',
  price: 89.9,
  originalPrice: 149.9,
  discountPct: 40,
  salesCount: 1200,
  shipping: 'FREE',
  images: [],
  originalUrl: 'https://shopee.com.br/produto-exemplo',
  raw: {},
};

export function productRowToData(p: Product): ProductData {
  return {
    source: p.source,
    title: p.title,
    price: Number(p.price),
    images: p.images,
    shipping: p.shipping,
    originalUrl: p.originalUrl,
    raw: p.raw,
    ...(p.originalPrice !== null ? { originalPrice: Number(p.originalPrice) } : {}),
    ...(p.discountPct !== null ? { discountPct: p.discountPct } : {}),
    ...(p.salesCount !== null ? { salesCount: p.salesCount } : {}),
    ...(p.couponCode ? { couponCode: p.couponCode } : {}),
  };
}
