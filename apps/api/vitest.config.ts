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
      SESSION_SECRET: '8e2f1a4c9b6d3e7f2a1c5b8d9e3f7a1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
    },
  },
});
