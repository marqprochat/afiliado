import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApiError } from '@afilados/shared';

export function registerErrorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const message = err.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return reply.status(400).send({ error: { code: 'VALIDATION', message } });
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
