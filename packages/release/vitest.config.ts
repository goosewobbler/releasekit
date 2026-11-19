import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['**/*.spec.ts'],
      coverage: {
        thresholds: { lines: 89, functions: 93, branches: 83, statements: 89 },
      },
      setupFiles: ['test/setup.ts'],
    },
  }),
);
