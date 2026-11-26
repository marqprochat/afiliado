import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@afilados/db';
import { AWIN_WEBHOOK_TOKEN_KEY, parseSalesQuery, type AwinWebhookInfo } from '@afilados/shared';
import { config } from '../config';
import { forbidAffiliate, requireAuth } from '../plugins/auth';
import { getSalesSummary, listSales } from '../lib/sales/summary';

const newToken = () => randomBytes(32).toString('base64url');

/** Origem pública para montar a URL do webhook: DOMAIN em produção; senão o host da requisição. */
function publicOrigin(req: FastifyRequest): string {
  if (config.DOMAIN)
    return `https://${config.DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  const header = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  const proto = header(req.headers['x-forwarded-proto']) ?? req.protocol;
  const host = header(req.headers['x-forwarded-host']) ?? header(req.headers.host) ?? 'localhost';
  return `${proto}://${host}`;
}

function webhookInfo(req: FastifyRequest, token: string): AwinWebhookInfo {
  const path = `/api/v1/webhooks/awin/${token}`;
  return { path, url: `${publicOrigin(req)}${path}` };
}

async function saveToken(tenantId: string, token: string) {
  await prisma.setting.upsert({
    where: { tenantId_key: { tenantId, key: AWIN_WEBHOOK_TOKEN_KEY } },
    create: { tenantId, key: AWIN_WEBHOOK_TOKEN_KEY, value: token },
    update: { value: token },
  });
}

export async function salesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/sales/summary', async (req) =>
    getSalesSummary(req.tenantId, parseSalesQuery(req.query)),
  );
  app.get('/sales', async (req) => listSales(req.tenantId, parseSalesQuery(req.query)));

  /** URL do webhook de transações da Awin; gera o segredo na primeira vez. */
  app.get('/sales/awin-webhook', { preHandler: forbidAffiliate }, async (req) => {
    const row = await prisma.setting.findFirst({
      where: { tenantId: req.tenantId, key: AWIN_WEBHOOK_TOKEN_KEY },
    });
    let token = typeof row?.value === 'string' && row.value ? row.value : null;
    if (!token) {
      token = newToken();
      await saveToken(req.tenantId, token);
    }
    return webhookInfo(req, token);
  });

  /** Troca o segredo: a URL antiga deixa de funcionar (responde 404). */
  app.post('/sales/awin-webhook/rotate', { preHandler: forbidAffiliate }, async (req) => {
    const token = newToken();
    await saveToken(req.tenantId, token);
    return webhookInfo(req, token);
  });
}
