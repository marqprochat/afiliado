import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_PORT: z.coerce.number().int().default(3002),
  DATABASE_URL: z.string().url().default('postgresql://afilados:afilados@localhost:5434/afilados'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .default('fc621d22b6cb2e4531fb4679981d07484469e616b255983f67b328cfc3c369f3'),
  SHOPEE_MOCK: z.string().optional(),
  WA_BROWSER_NAME: z.string().default('Afilados'),
});
export const config = schema.parse(process.env);
