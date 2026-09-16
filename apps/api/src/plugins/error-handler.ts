import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '@afilados/shared';
import { Prisma } from '@afilados/db';

export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
  });
  app.setErrorHandler((err, req, reply) => {
    if (
      err instanceof ApiError ||
      (err && typeof err === 'object' && (err as { name?: string }).name === 'ApiError')
    ) {
      const apiErr = err as ApiError;
      return reply
        .status(apiErr.status ?? 500)
        .send({ error: { code: apiErr.code ?? 'INTERNAL', message: apiErr.message } });
    }
    if (err instanceof ZodError) {
      const message = err.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return reply.status(400).send({ error: { code: 'VALIDATION', message } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return reply
          .status(409)
          .send({ error: { code: 'VALIDATION', message: 'registro duplicado' } });
      }
      if (err.code === 'P2003') {
        return reply.status(409).send({
          error: { code: 'VALIDATION', message: 'registro referenciado por outros dados' },
        });
      }
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Não encontrado' } });
      }
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply
        .status(429)
        .send({ error: { code: 'VALIDATION', message: 'Muitas tentativas' } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Erro interno' } });
  });
}
