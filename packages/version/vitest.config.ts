import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        thresholds: { lines: 87, functions: 90, branches: 80, statements: 87 },
      },
      setupFiles: [],
    },
  }),
);
