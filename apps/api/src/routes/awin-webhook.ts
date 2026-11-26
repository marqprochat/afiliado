import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { prisma, upsertAffiliateSale } from '@afilados/db';
import { parseAwinWebhookBody } from '@afilados/marketplaces';
import { ApiError, AWIN_WEBHOOK_TOKEN_KEY } from '@afilados/shared';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Tenant dono do token do webhook. Compara em tempo constante (hash de tamanho fixo) com cada
 * token cadastrado — são poucos (um por conta) e assim não há busca indexada pelo segredo.
 */
async function tenantForWebhookToken(token: string): Promise<string | null> {
  const rows = await prisma.setting.findMany({
    where: { key: AWIN_WEBHOOK_TOKEN_KEY },
    select: { tenantId: true, value: true },
  });
  const given = digest(token);
  let found: string | null = null;
  for (const row of rows) {
    if (typeof row.value !== 'string' || !row.value) continue;
    if (timingSafeEqual(given, digest(row.value)) && !found) found = row.tenantId;
  }
  return found;
}

/**
 * "Transaction notifications" da Awin: `POST /webhooks/awin/:token` (público, sem sessão).
 * Token inválido → 404; corpo sem transação → 400. Só grava no banco (sem chamadas externas).
 */
export async function awinWebhookRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // O formato do corpo não é bem documentado: aceita também form-urlencoded (vira objeto).
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );

  app.post('/webhooks/awin/:token', async (req, reply) => {
    const { token } = req.params as { token?: string };
    const tenantId = token && token.length <= 200 ? await tenantForWebhookToken(token) : null;
    if (!tenantId) throw ApiError.notFound('Webhook não encontrado');

    const transactions = parseAwinWebhookBody(req.body);
    if (transactions.length === 0) {
      throw ApiError.validation('Corpo sem transação da Awin reconhecível');
    }
    for (const t of transactions) {
      await upsertAffiliateSale(tenantId, t, 'WEBHOOK');
    }
    return reply.send({ ok: true, received: transactions.length });
  });
}
