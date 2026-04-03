import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: { resolve: ['@releasekit/core', '@releasekit/config'] },
  noExternal: [
    '@releasekit/core',
    '@releasekit/config',
    'conventional-changelog-angular',
    'conventional-changelog-conventionalcommits',
    'conventional-changelog-preset-loader',
    'conventional-commits-filter',
    'conventional-commits-parser',
    'conventional-recommended-bump',
    '@conventional-changelog/git-client',
    '@simple-libs/stream-utils',
    '@simple-libs/child-process-utils',
  ],
  external: [/^[^.]/],
} as Options);
