import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: { resolve: ['@releasekit/core', '@releasekit/config'] },
  noExternal: ['@releasekit/core', '@releasekit/config'],
  external: [/^[^.]/],
} as Options);
