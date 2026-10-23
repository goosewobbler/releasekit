import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: { resolve: ['@releasekit/core', '@releasekit/config', '@releasekit/forge', '@releasekit/git'] },
  noExternal: ['@releasekit/core', '@releasekit/config', '@releasekit/forge', '@releasekit/git'],
  // Bare package names only: the declaration build also checks resolved absolute paths, and @releasekit/* is bundled.
  external: [/^(?![./]|[A-Za-z]:[\\/]|@releasekit\/)/],
});
