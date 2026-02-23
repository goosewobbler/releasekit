import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.spec.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
