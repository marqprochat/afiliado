import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AiCtaError, generateCta } from '@afilados/core';
import { assertPublicHttpUrl } from '@afilados/core/safe-url';
import { ApiError, aiSettingsUpdateSchema, aiTestSchema } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import {
  SAMPLE_PRODUCT,
  applyPatch,
  assertComplete,
  effectiveAi,
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

function rejectCredentials(isAffiliate: boolean, patch: Record<string, unknown>) {
  if (
    isAffiliate &&
    (patch.baseUrl !== undefined || patch.model !== undefined || patch.apiKey !== undefined)
  ) {
    throw ApiError.forbidden('A conexão de IA é gerenciada pelo administrador');
  }
}

const AI_UNAVAILABLE_MESSAGE = 'A IA está indisponível, fale com o administrador';

/**
 * Para o afiliado, o detalhe da configuração (URL, chave, provedor) é do administrador: devolve
 * mensagem genérica e registra o detalhe no log. Para a conta raiz, o erro segue intacto.
 */
function hideFromAffiliate(req: FastifyRequest, e: unknown, status: 400 | 502): unknown {
  if (!req.isAffiliate) return e;
  req.log.warn(
    { tenantId: req.tenantId, err: e instanceof Error ? e.message : String(e) },
    'IA indisponível para afiliado',
  );
  return new ApiError('AI_ERROR', AI_UNAVAILABLE_MESSAGE, status);
}

export async function aiSettingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/settings/ai', async (req) => {
    const own = await loadStoredAi(req.db);
    return toPublicAi(await effectiveAi(req.db, own), req.isAffiliate);
  });

  app.put('/settings/ai', async (req) => {
    const patch = aiSettingsUpdateSchema.parse(req.body);
    rejectCredentials(req.isAffiliate, patch);
    const next = applyPatch(await loadStoredAi(req.db), patch);
    if (next.baseUrl && !req.isAffiliate) await assertSafeBaseUrl(next.baseUrl);
    const effective = await effectiveAi(req.db, next);
    if (next.enabled) assertComplete(effective, 'Para ativar', req.isAffiliate);
    await saveStoredAi(req.db, req.tenantId, next);
    return toPublicAi(effective, req.isAffiliate);
  });

  app.post('/settings/ai/test', async (req) => {
    const { productId, ...draft } = aiTestSchema.parse(req.body);
    rejectCredentials(req.isAffiliate, draft);
    const merged = await effectiveAi(req.db, applyPatch(await loadStoredAi(req.db), draft));
    assertComplete(merged, 'Para testar', req.isAffiliate);
    try {
      await assertSafeBaseUrl(merged.baseUrl);
    } catch (e) {
      throw hideFromAffiliate(req, e, 400);
    }
    let product = SAMPLE_PRODUCT;
    if (productId) {
      const row = await req.db.product.findFirst({ where: { id: productId } });
      if (!row) throw ApiError.notFound('Produto não encontrado');
      product = productRowToData(row);
    }
    let ctaConfig: ReturnType<typeof toCtaConfig>;
    try {
      ctaConfig = toCtaConfig(merged);
    } catch (e) {
      throw hideFromAffiliate(req, e, 400);
    }
    const started = Date.now();
    try {
      const cta = await generateCta(product, ctaConfig, {
        validateBaseUrl: (url) => assertPublicHttpUrl(url),
      });
      return { cta, latencyMs: Date.now() - started };
    } catch (e) {
      if (e instanceof AiCtaError) {
        if (e.kind === 'blocked') throw hideFromAffiliate(req, ApiError.validation(e.message), 400);
        throw hideFromAffiliate(req, new ApiError('AI_ERROR', e.message, 502), 502);
      }
      throw e;
    }
  });
}
