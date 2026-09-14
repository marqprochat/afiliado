import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config';
import { registerErrorHandler } from './plugins/error-handler';
import { healthRoutes } from './routes/health';

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  registerErrorHandler(app);
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
    },
    { prefix: '/api/v1' },
  );
  return app;
}
