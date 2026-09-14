import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : { command: 'pnpm dev', port: 3000, reuseExistingServer: true, timeout: 120_000 },
});
