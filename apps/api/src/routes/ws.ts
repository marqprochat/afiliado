import type { FastifyInstance } from 'fastify';

export async function wsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!req.user) {
      socket.close(4401, 'Não autenticado');
      return;
    }
    app.events.addSocket(req.tenantId, socket);
  });
}
