import { defineConfig, type Options } from 'tsup';

export default defineConfig({
  banner: {
    js: `import {createRequire as __createRequire} from 'module';
var require = __createRequire(import.meta.url);`.trim(),
  },
  entry: ['src/dispatcher.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  bundle: true,
  dts: false,
  minify: false,
  splitting: false,
  noExternal: [
    '@releasekit/core',
    '@releasekit/config',
    '@releasekit/version',
    '@releasekit/notes',
    '@releasekit/publish',
    'chalk',
    'smol-toml',
    'zod',
  ],
} as Options);
