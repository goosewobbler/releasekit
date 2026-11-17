import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.spec.ts'],
      coverage: {
        thresholds: { lines: 96, functions: 96, branches: 89, statements: 95 },
      },
    },
  }),
);
