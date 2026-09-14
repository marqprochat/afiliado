import type { FastifyInstance } from 'fastify';
import { prisma } from '@afilados/db';
import { requireAuth } from '../plugins/auth';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const u = req.user!;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: req.tenantId } });
    return {
      user: { id: u.id, email: u.email, name: u.name, role: u.role },
      tenant: { id: tenant.id, name: tenant.name },
    };
  });
}
