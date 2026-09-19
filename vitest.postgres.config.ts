import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/postgres/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 30000,
    retry: 0,
    fileParallelism: false,
    env: { TZ: 'UTC' },
  },
});
