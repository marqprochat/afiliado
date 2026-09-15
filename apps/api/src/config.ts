import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://afilados:afilados@localhost:5434/afilados'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SESSION_SECRET: z
    .string()
    .min(16)
    .default('8e2f1a4c9b6d3e7f2a1c5b8d9e3f7a1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e'),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .default('fc621d22b6cb2e4531fb4679981d07484469e616b255983f67b328cfc3c369f3'),
  SHOPEE_MOCK: z.string().optional(),
  // Web faz proxy same-origin de /api/*, então não há CORS a configurar; WEB_ORIGIN
  // só é usada para validar o header Origin em /ws quando presente (produção).
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
});

export type Config = z.infer<typeof schema>;
export const config: Config = schema.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
