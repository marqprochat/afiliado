import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { apiTokenCreateSchema, ApiError } from '@afilados/shared';
import { requireAuth } from '../plugins/auth';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function apiTokensRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Listar tokens ativos do tenant
  app.get('/api-tokens', async (req) => {
    const tokens = await req.db.apiToken.findMany({
      where: { tenantId: req.tenantId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tokenHint: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    return { tokens };
  });

  // Criar novo token de API (retorna o token em texto puro uma única vez)
  app.post('/api-tokens', async (req) => {
    const { name } = apiTokenCreateSchema.parse(req.body);
    const rawToken = `afil_${randomBytes(24).toString('hex')}`;
    const tokenHash = hashToken(rawToken);
    const tokenHint = rawToken.slice(-4);

    const tokenRow = await req.db.apiToken.create({
      data: {
        tenantId: req.tenantId,
        name,
        tokenHash,
        tokenHint,
      },
      select: {
        id: true,
        name: true,
        tokenHint: true,
        createdAt: true,
      },
    });

    return {
      token: rawToken,
      ...tokenRow,
    };
  });

  // Revogar token
  app.delete('/api-tokens/:id', async (req) => {
    const { id } = req.params as { id: string };
    const existing = await req.db.apiToken.findFirst({
      where: { id, tenantId: req.tenantId },
    });
    if (!existing) {
      throw ApiError.notFound('Token não encontrado');
    }

    await req.db.apiToken.updateMany({
      where: { id, tenantId: req.tenantId },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  });
}
