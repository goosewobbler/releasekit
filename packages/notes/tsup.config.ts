import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: { resolve: ['@releasekit/core', '@releasekit/config', '@releasekit/forge', '@releasekit/git'] },
  noExternal: ['@releasekit/core', '@releasekit/config', '@releasekit/forge', '@releasekit/git'],
  // Externalize npm packages, but not the bundled @releasekit/* or local files (relative or absolute paths).
  external: [/^(?![./]|[A-Za-z]:[\\/]|@releasekit\/)/],
});
