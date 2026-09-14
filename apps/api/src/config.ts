import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(16),
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  SHOPEE_MOCK: z.string().optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
});

export type Config = z.infer<typeof schema>;
export const config: Config = schema.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
