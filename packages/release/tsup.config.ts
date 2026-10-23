import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  banner: {
    js: `import {createRequire as __createRequire} from 'module';
var require = __createRequire(import.meta.url);`.trim(),
  },
  entry: ['src/index.ts', 'src/dispatcher.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: {
    entry: 'src/index.ts',
    resolve: ['@releasekit/core', '@releasekit/config', '@releasekit/forge', '@releasekit/git'],
  },
  minify: false,
  splitting: false,
  external: ['minimatch'],
  noExternal: [
    '@releasekit/core',
    '@releasekit/config',
    '@releasekit/forge',
    '@releasekit/git',
    '@releasekit/version',
    '@releasekit/notes',
    '@releasekit/publish',
  ],
} as Options);
