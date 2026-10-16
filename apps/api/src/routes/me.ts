import type { FastifyInstance } from 'fastify';
import { prisma } from '@afilados/db';
import { requireAuth } from '../plugins/auth';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const u = req.user!;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: req.tenantId } });
    const impersonator = req.impersonatorUserId
      ? await prisma.user.findUnique({ where: { id: req.impersonatorUserId }, select: { name: true } })
      : null;
    return {
      user: { id: u.id, email: u.email, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin },
      tenant: { id: tenant.id, name: tenant.name },
      isAffiliate: req.isAffiliate,
      impersonating: impersonator ? { by: impersonator.name } : null,
    };
  });
}
