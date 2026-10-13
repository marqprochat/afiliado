import type { FastifyInstance, FastifyRequest } from 'fastify';
import { metricsQuerySchema, type MetricsQuery } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { assertGroupOfTenant } from '../lib/metrics/common';
import { getAutomationMetrics } from '../lib/metrics/automation';
import { getClicksMetrics } from '../lib/metrics/clicks';
import { getGroupsMetrics } from '../lib/metrics/groups';
import { getOverviewMetrics } from '../lib/metrics/overview';
import { getProductsMetrics } from '../lib/metrics/products';
import { getSendsMetrics } from '../lib/metrics/sends';

/** Valida a query (ZodError → 400) e garante que o grupo filtrado é do tenant (senão 404). */
async function parseQuery(req: FastifyRequest): Promise<MetricsQuery> {
  const q = metricsQuerySchema.parse(req.query);
  await assertGroupOfTenant(req.tenantId, q.groupJid);
  return q;
}

export async function metricsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/metrics/overview', async (req) =>
    getOverviewMetrics(req.tenantId, await parseQuery(req)),
  );
  app.get('/metrics/groups', async (req) => getGroupsMetrics(req.tenantId, await parseQuery(req)));
  app.get('/metrics/sends', async (req) => getSendsMetrics(req.tenantId, await parseQuery(req)));
  app.get('/metrics/products', async (req) =>
    getProductsMetrics(req.tenantId, await parseQuery(req)),
  );
  app.get('/metrics/clicks', async (req) => getClicksMetrics(req.tenantId, await parseQuery(req)));
  app.get('/metrics/automation', async (req) =>
    getAutomationMetrics(req.tenantId, await parseQuery(req)),
  );
}
