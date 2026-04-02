import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/dispatcher.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  shims: true,
  splitting: false,
  dts: { resolve: ['@releasekit/core', '@releasekit/config'] },
  noExternal: [
    '@releasekit/core',
    '@releasekit/config',
    '@releasekit/version',
    '@releasekit/notes',
    '@releasekit/publish',
  ],
});
