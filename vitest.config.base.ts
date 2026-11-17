import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/types.ts', 'src/index.ts'],
      all: true,
    },
  },
});
