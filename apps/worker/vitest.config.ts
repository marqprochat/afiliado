import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://afilados:afilados@localhost:5434/afilados',
      REDIS_URL: 'redis://localhost:6379',
      APP_ENCRYPTION_KEY: 'fc621d22b6cb2e4531fb4679981d07484469e616b255983f67b328cfc3c369f3',
    },
  },
});
