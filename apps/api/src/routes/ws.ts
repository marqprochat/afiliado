import type { FastifyInstance } from 'fastify';
import { config } from '../config';

export async function wsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!req.user) {
      socket.close(4401, 'Não autenticado');
      return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== config.WEB_ORIGIN && config.NODE_ENV === 'production') {
      socket.close(4403, 'Origem não permitida');
      return;
    }
    app.events.addSocket(req.tenantId, socket);
  });
}
