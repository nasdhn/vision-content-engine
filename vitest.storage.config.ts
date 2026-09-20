import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/storage/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 30000,
    retry: 0,
    env: { TZ: 'UTC' },
  },
});
