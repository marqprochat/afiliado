import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { config } from './config';
import { registerErrorHandler } from './plugins/error-handler';
import { authPlugin } from './plugins/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { settingsRoutes } from './routes/settings';

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  registerErrorHandler(app);
  await app.register(authPlugin);
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(settingsRoutes);
    },
    { prefix: '/api/v1' },
  );
  return app;
}
