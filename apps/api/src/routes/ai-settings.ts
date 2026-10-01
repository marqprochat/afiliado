import type { FastifyInstance } from 'fastify';
import { AiCtaError, generateCta } from '@afilados/core';
import { assertPublicHttpUrl } from '@afilados/core/safe-url';
import { ApiError, aiSettingsUpdateSchema, aiTestSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import {
  SAMPLE_PRODUCT,
  applyPatch,
  assertComplete,
  loadStoredAi,
  productRowToData,
  saveStoredAi,
  toCtaConfig,
  toPublicAi,
} from '../lib/ai-settings';

async function assertSafeBaseUrl(url: string) {
  try {
    await assertPublicHttpUrl(url);
  } catch (e) {
    throw ApiError.validation(`Base URL inválida: ${e instanceof Error ? e.message : 'bloqueada'}`);
  }
}

export async function aiSettingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/settings/ai', async (req) => toPublicAi(await loadStoredAi(req.db)));

  app.put('/settings/ai', async (req) => {
    const patch = aiSettingsUpdateSchema.parse(req.body);
    const next = applyPatch(await loadStoredAi(req.db), patch);
    if (next.baseUrl) await assertSafeBaseUrl(next.baseUrl);
    if (next.enabled) assertComplete(next, 'Para ativar');
    await saveStoredAi(req.db, req.tenantId, next);
    return toPublicAi(next);
  });

  app.post('/settings/ai/test', async (req) => {
    const { productId, ...draft } = aiTestSchema.parse(req.body);
    const merged = applyPatch(await loadStoredAi(req.db), draft);
    assertComplete(merged, 'Para testar');
    await assertSafeBaseUrl(merged.baseUrl);
    let product = SAMPLE_PRODUCT;
    if (productId) {
      const row = await req.db.product.findFirst({ where: { id: productId } });
      if (!row) throw ApiError.notFound('Produto não encontrado');
      product = productRowToData(row);
    }
    const started = Date.now();
    try {
      const cta = await generateCta(product, toCtaConfig(merged), {
        validateBaseUrl: (url) => assertPublicHttpUrl(url),
      });
      return { cta, latencyMs: Date.now() - started };
    } catch (e) {
      if (e instanceof AiCtaError) {
        if (e.kind === 'blocked') throw ApiError.validation(e.message);
        throw new ApiError('AI_ERROR', e.message, 502);
      }
      throw e;
    }
  });
}
