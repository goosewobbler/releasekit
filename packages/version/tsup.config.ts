import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: { resolve: ['@releasekit/core', '@releasekit/config', '@releasekit/git'] },
  noExternal: ['@releasekit/core', '@releasekit/config', '@releasekit/git'],
  // Externalize npm packages, but not the bundled @releasekit/* or local files (relative or absolute paths).
  external: [/^(?![./]|[A-Za-z]:[\\/]|@releasekit\/)/],
} as Options);
