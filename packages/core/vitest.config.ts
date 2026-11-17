import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.spec.ts'],
      coverage: {
        thresholds: { lines: 88, functions: 89, branches: 82, statements: 89 },
      },
    },
  }),
);
