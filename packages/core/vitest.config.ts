import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.spec.ts'],
      coverage: {
        exclude: ['**/*.spec.ts', '**/*.test.ts', 'src/index.ts', 'src/types.ts'],
      },
    },
  }),
);
