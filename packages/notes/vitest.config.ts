import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.base.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/**/*.spec.ts'],
      coverage: {
        exclude: [
          '**/*.spec.ts',
          '**/*.test.ts',
          '**/types.ts',
          'src/index.ts',
          'src/cli.ts',
          'src/llm/anthropic.ts',
          'src/llm/openai.ts',
          'src/llm/ollama.ts',
          'src/llm/openai-compatible.ts',
          'src/llm/base.ts',
          'src/llm/provider.ts',
          'src/input/git-log.ts',
          'src/input/index.ts',
          'src/monorepo/index.ts',
          'src/monorepo/aggregator.ts',
          'src/output/index.ts',
          'src/output/github-release.ts',
          'src/templates/index.ts',
          'src/templates/ejs.ts',
          'src/templates/handlebars.ts',
          'src/templates/liquid.ts',
          'src/templates/loader.ts',
          'src/core/pipeline.ts',
        ],
        thresholds: {
          lines: 50,
          functions: 55,
          branches: 45,
          statements: 50,
        },
      },
    },
  }),
);
