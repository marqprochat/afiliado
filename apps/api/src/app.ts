import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { config } from './config';
import { registerErrorHandler } from './plugins/error-handler';
import { authPlugin } from './plugins/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { settingsRoutes } from './routes/settings';
import { marketplacesRoutes } from './routes/marketplaces';
import { productsRoutes } from './routes/products';
import { queueRoutes } from './routes/queue';
import { wsRoutes } from './routes/ws';
import { waRoutes } from './routes/wa';
import { templatesRoutes } from './routes/templates';
import { batchesRoutes } from './routes/batches';
import { mirrorRoutes } from './routes/mirror';
import { overviewRoutes } from './routes/overview';
import { apiTokensRoutes } from './routes/api-tokens';
import { extensionRoutes } from './routes/extension';
import { automationsRoutes } from './routes/automations';

import { EventHub } from './lib/events';
import { closeRedis } from './lib/redis';

declare module 'fastify' {
  interface FastifyInstance {
    events: EventHub;
  }
}

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Requested-With'],
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  registerErrorHandler(app);
  await app.register(authPlugin);
  await app.register(websocket);
  const events = new EventHub();
  await events.start();
  app.decorate('events', events);
  app.addHook('onClose', async () => {
    await events.stop();
    await closeRedis();
  });
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(settingsRoutes);
      await api.register(marketplacesRoutes);
      await api.register(productsRoutes);
      await api.register(queueRoutes);
      await api.register(wsRoutes);
      await api.register(waRoutes);
      await api.register(templatesRoutes);
      await api.register(batchesRoutes);
      await api.register(mirrorRoutes);
      await api.register(overviewRoutes);
      await api.register(apiTokensRoutes);
      await api.register(extensionRoutes);
      await api.register(automationsRoutes);
    },
    { prefix: '/api/v1' },
  );
  return app;
}
