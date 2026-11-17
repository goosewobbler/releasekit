import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.spec.ts'],
      coverage: {
        thresholds: { lines: 90, functions: 88, branches: 81, statements: 90 },
      },
    },
  }),
);
