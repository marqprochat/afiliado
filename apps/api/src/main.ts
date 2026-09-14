import { buildApp } from './app';
import { config } from './config';

const app = await buildApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });
