import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        exclude: [
          '**/*.spec.ts',
          '**/*.test.ts',
          '**/types.ts',
          'src/index.ts', // Exclude CLI entry point
        ],
      },
      setupFiles: [],
      globalSetup: './test/setup.ts',
    },
  }),
);
