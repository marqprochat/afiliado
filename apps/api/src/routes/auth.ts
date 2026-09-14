import type { FastifyInstance } from 'fastify';
import { verify } from '@node-rs/argon2';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@afilados/db';
import { ApiError, loginSchema } from '@afilados/shared';
import { isProd } from '../config';
import { SESSION_COOKIE, createSession, destroySession } from '../lib/session';

export async function authRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { max: 10, timeWindow: '1 minute' });

  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    const ok = user ? await verify(user.passwordHash, body.password) : false;
    if (!user || !ok) throw ApiError.unauthorized('E-mail ou senha inválidos');
    const { token, expiresAt } = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      expires: expiresAt,
    });
    return reply.status(204).send();
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });
}
