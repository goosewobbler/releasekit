import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/dispatcher.ts'],
  format: ['esm'],
  platform: 'node',
  shims: true,
  dts: { resolve: ['@releasekit/core', '@releasekit/config'] },
  // @releasekit/core and @releasekit/config are inlined into every output file.
  // Because they are bundled they must remain in devDependencies, NOT dependencies.
  // Moving them to dependencies would cause pnpm to fetch them from the registry
  // as standalone packages, producing a 404 (they are not published independently).
  noExternal: [
    '@releasekit/core',
    '@releasekit/config',
    '@releasekit/version',
    '@releasekit/notes',
    '@releasekit/publish',
  ],
});
