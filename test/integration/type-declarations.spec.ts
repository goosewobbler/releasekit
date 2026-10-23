import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../packages/', import.meta.url));

interface Manifest {
  name: string;
  private?: boolean;
  types?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const published = readdirSync(PACKAGES)
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(PACKAGES, dir, 'package.json'), 'utf-8')) as Manifest }))
  .filter(({ manifest }) => !manifest.private && manifest.types);

const packageName = (spec: string): string =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/');

describe.each(published)('$manifest.name type declarations', ({ dir, manifest }) => {
  it('should ship the declarations its package.json points to', () => {
    expect(existsSync(join(PACKAGES, dir, manifest.types ?? ''))).toBe(true);
  });

  it('should import only files in dist and declared dependencies', () => {
    const dist = join(PACKAGES, dir, 'dist');
    const dependencies = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }));
    const problems: string[] = [];
    for (const file of readdirSync(dist).filter((name) => name.endsWith('.d.ts'))) {
      for (const [, spec] of readFileSync(join(dist, file), 'utf-8').matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        if (spec.startsWith('.')) {
          if (!existsSync(join(dist, spec.replace(/\.js$/, '.d.ts')))) {
            problems.push(`${file} imports ${spec}, which isn't in dist`);
          }
        } else if (
          !spec.startsWith('node:') &&
          !builtinModules.includes(spec) &&
          !dependencies.has(packageName(spec))
        ) {
          problems.push(`${file} imports ${spec}, which isn't a dependency`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
