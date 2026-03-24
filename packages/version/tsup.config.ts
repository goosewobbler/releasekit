import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: { resolve: ['@releasekit/core', '@releasekit/config'] },
  noExternal: ['@releasekit/core', '@releasekit/config'],
});
