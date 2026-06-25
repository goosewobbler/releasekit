import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: { resolve: ['@releasekit/core', '@releasekit/config', '@releasekit/git'] },
  noExternal: ['@releasekit/core', '@releasekit/config', '@releasekit/git'],
  external: [/^[^.]/],
} as Options);
