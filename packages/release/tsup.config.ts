import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/dispatcher.ts'],
  format: ['esm'],
  dts: { resolve: ['@releasekit/core', '@releasekit/config'] },
  noExternal: ['@releasekit/core', '@releasekit/config'],
  // Externalize all bare specifiers (packages). noExternal takes precedence,
  // so core/config are still bundled. This avoids relying on tsup's
  // auto-externalization which can break with noExternal + pnpm workspaces.
  external: [/^[^.]/],
});
