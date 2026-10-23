import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: { resolve: ['@releasekit/core', '@releasekit/config', '@releasekit/git'] },
  noExternal: ['@releasekit/core', '@releasekit/config', '@releasekit/git'],
  // Bare package names only. The declaration build also matches resolved paths against this; @releasekit/* is bundled.
  external: [/^(?![./]|[A-Za-z]:[\\/]|@releasekit\/)/],
} as Options);
