import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { forTenant, type TenantClient, type User } from '@afilados/db';
import { ApiError } from '@afilados/shared';
import { SESSION_COOKIE, validateSession } from '../lib/session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    tenantId: string;
    db: TenantClient;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null);
  app.decorateRequest('tenantId', '');
  app.decorateRequest('db', null as unknown as TenantClient);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const s = await validateSession(token);
    if (!s) return;
    req.user = s.user;
    req.tenantId = s.tenantId;
    req.db = forTenant(s.tenantId);
  });
});

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  if (!req.user) throw ApiError.unauthorized();
}
