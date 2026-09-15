import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encryptJson, decryptJson } from '@afilados/db';
import {
  ApiError,
  MARKETPLACE_KINDS,
  marketplaceKindParam,
  marketplaceUpdateSchema,
} from '@afilados/shared';
import { requireAuth } from '../plugins/auth';
import { getAdapter, getShopeeAdapter, publicConnection } from '../lib/marketplaces';

const kindParams = z.object({ kind: marketplaceKindParam });

export async function marketplacesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/marketplaces', async (req) => {
    const rows = await req.db.marketplaceConnection.findMany();
    return MARKETPLACE_KINDS.map((kind) =>
      publicConnection(rows.find((r) => r.kind === kind) ?? null, kind),
    );
  });

  app.put('/marketplaces/:kind', async (req) => {
    const { kind } = kindParams.parse(req.params);
    const body = marketplaceUpdateSchema.parse(req.body);
    const existing = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    const prev = existing?.encryptedCredentials
      ? decryptJson<{
          appId?: string;
          secret?: string;
          tag?: string;
          mattWord?: string;
          mattTool?: string;
        }>(Buffer.from(existing.encryptedCredentials))
      : {};
    const merged =
      kind === 'SHOPEE'
        ? { appId: body.appId ?? prev.appId, secret: body.secret ?? prev.secret }
        : kind === 'MERCADOLIVRE'
          ? {
              mattWord: body.mattWord ?? prev.mattWord,
              mattTool: body.mattTool ?? prev.mattTool,
            }
          : { tag: body.affiliateTag ?? prev.tag };
    const hasAny = Object.values(merged).some((v) => v);
    const data = {
      encryptedCredentials: hasAny ? encryptJson(merged) : null,
      affiliateTag:
        kind === 'MERCADOLIVRE'
          ? (merged.mattWord ?? null)
          : (body.affiliateTag ?? existing?.affiliateTag ?? null),
      status: 'UNCONFIGURED' as const,
      lastError: null,
    };
    if (existing)
      await req.db.marketplaceConnection.updateMany({ where: { id: existing.id }, data });
    // @ts-expect-error tenantId é injetado pela extensão forTenant
    else await req.db.marketplaceConnection.create({ data: { kind, ...data } });
    const row = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    return publicConnection(row, kind);
  });

  app.post('/marketplaces/:kind/check', async (req) => {
    const { kind } = kindParams.parse(req.params);
    const row = await req.db.marketplaceConnection.findFirst({ where: { kind } });
    if (!row?.encryptedCredentials)
      throw new ApiError('SHOPEE_UNCONFIGURED', 'Configure as credenciais', 400);
    const result =
      kind === 'SHOPEE'
        ? await getShopeeAdapter().checkConnection(
            decryptJson(Buffer.from(row.encryptedCredentials)),
          )
        : await getAdapter(kind).checkConnection(
            decryptJson(Buffer.from(row.encryptedCredentials)),
          );
    await req.db.marketplaceConnection.updateMany({
      where: { id: row.id },
      data: {
        status: result.ok ? 'OK' : 'ERROR',
        lastCheckedAt: new Date(),
        lastError: result.error ?? null,
      },
    });
    return publicConnection(
      await req.db.marketplaceConnection.findFirst({ where: { kind } }),
      kind,
    );
  });
}
