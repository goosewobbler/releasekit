import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  entry: ['src/dispatcher.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: false,
  minify: false,
  splitting: false,
  external: ['commander', 'events', 'node:events'],
  noExternal: [
    '@releasekit/core',
    '@releasekit/config',
    '@releasekit/version',
    '@releasekit/notes',
    '@releasekit/publish',
    'chalk',
    'ora',
    'semver',
    'zod',
    'smol-toml',
    '@octokit/rest',
  ],
} as Options);
