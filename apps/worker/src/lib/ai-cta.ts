import { decryptJson } from '@afilados/db';
import { AiCtaError, generateCta, type AiCtaConfig } from '@afilados/core';
import { AI_DEFAULTS, type ProductData, type StoredAiConfig } from '@afilados/shared';
import { assertPublicHttpUrl } from './safe-url';

const CTA_VAR_RE = /\{#?cta\}/;

export function templateUsesCta(body: string): boolean {
  return CTA_VAR_RE.test(body);
}

export interface ResolveCtaInput {
  settings: Record<string, unknown>;
  templateBody: string;
  product: ProductData;
  batchItemId: string;
  log: { warn: (obj: object, msg: string) => void };
  generate?: typeof generateCta;
}

/**
 * CTA do item: gera pela IA só se `ai.enabled` e o template usa `{cta}`.
 * NUNCA lança — qualquer falha vira `''` (a mensagem sai sem CTA e a fila segue).
 */
export async function resolveItemCta(input: ResolveCtaInput): Promise<string> {
  const stored = input.settings.ai as StoredAiConfig | undefined;
  if (!stored?.enabled || !templateUsesCta(input.templateBody)) return '';
  try {
    if (!stored.baseUrl || !stored.model || !stored.encryptedApiKey) {
      throw new Error('configuração de IA incompleta');
    }
    const { apiKey } = decryptJson<{ apiKey: string }>(Buffer.from(stored.encryptedApiKey, 'base64'));
    const config: AiCtaConfig = {
      baseUrl: stored.baseUrl,
      apiKey,
      model: stored.model,
      extraInstructions: stored.extraInstructions ?? AI_DEFAULTS.extraInstructions,
      tone: stored.tone ?? AI_DEFAULTS.tone,
      emojiLevel: stored.emojiLevel ?? AI_DEFAULTS.emojiLevel,
      maxChars: stored.maxChars ?? AI_DEFAULTS.maxChars,
      temperature: stored.temperature ?? AI_DEFAULTS.temperature,
    };
    return await (input.generate ?? generateCta)(input.product, config, {
      validateBaseUrl: (url) => assertPublicHttpUrl(url),
    });
  } catch (e) {
    const ai = e instanceof AiCtaError ? e : undefined;
    input.log.warn(
      {
        batchItemId: input.batchItemId,
        kind: ai?.kind ?? 'config',
        status: ai?.status,
        message: e instanceof Error ? e.message : String(e),
      },
      'falha ao gerar CTA com IA; enviando sem CTA',
    );
    return '';
  }
}
