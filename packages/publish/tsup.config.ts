import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: { resolve: ['@releasekit/core', '@releasekit/config'] },
  noExternal: ['@releasekit/core', '@releasekit/config'],
  external: Object.keys(pkg.dependencies ?? {}),
});
