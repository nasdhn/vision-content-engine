import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5174',
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
  },
  webServer: [
    {
      command: 'pnpm exec tsx --tsconfig tsconfig.json tests/browser/capture-server.ts',
      url: 'http://127.0.0.1:3201/healthz',
      reuseExistingServer: false,
      timeout: 30000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
    {
      command: 'pnpm exec tsx --tsconfig tsconfig.json tests/browser/server.ts',
      url: 'http://127.0.0.1:3100/healthz',
      reuseExistingServer: false,
      timeout: 30000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
    {
      command: 'pnpm dev:web',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
