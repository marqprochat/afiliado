import type { FastifyInstance } from 'fastify';
import { verify } from '@node-rs/argon2';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@afilados/db';
import { ApiError, loginSchema } from '@afilados/shared';
import {
  ADMIN_SESSION_COOKIE,
  SESSION_COOKIE,
  createSession,
  destroySession,
  sessionCookieOptions,
} from '../lib/session';

export async function authRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { max: 10, timeWindow: '1 minute' });

  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    const ok = user ? await verify(user.passwordHash, body.password) : false;
    if (!user || !ok) throw ApiError.unauthorized('E-mail ou senha inválidos');
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { active: true },
    });
    if (!tenant.active) throw new ApiError('ACCOUNT_DISABLED', 'Conta desativada', 403);
    const { token, expiresAt } = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return reply.status(204).send();
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    const adminToken = req.cookies[ADMIN_SESSION_COOKIE];
    if (adminToken) await destroySession(adminToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });
}
