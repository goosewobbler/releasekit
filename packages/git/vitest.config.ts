import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.spec.ts'],
      coverage: {
        thresholds: { lines: 95, functions: 92, branches: 92, statements: 95 },
      },
    },
  }),
);
