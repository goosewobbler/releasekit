import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// npm-packlist is the same library `npm pack` uses internally, but as an in-process
// function call. Replaces a multi-second `npm pack --dry-run` subprocess that flaked
// on CI runners (cold npm-CLI bootstrap was ~4-5s, brushing the 5s test timeout).
// @ts-expect-error - npm-packlist ships no type declarations.
import packlist from 'npm-packlist';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface PackTree {
  path: string;
  package: { name: string; version: string; files?: string[] };
}

// npm-packlist's documented API takes an Arborist node from `arborist.loadActual()`,
// but it only reads `node.path` and `node.package` for plain packages with a `files`
// field, no workspaces, and no bundleDependencies — which is what we test here. A
// minimal POJO is enough; pulling in @npmcli/arborist just to construct a real node
// would be a heavy dep for no gain. If a future npm-packlist version starts reading
// other Arborist properties (e.g. node.realpath, node.edgesIn) this will break loudly
// and we revisit.
const pack = (tree: PackTree): Promise<string[]> => packlist(tree) as Promise<string[]>;

describe('Package Content Verification', () => {
  let testDir: string;
  let pkgDir: string;
  let distDir: string;
  let pkgJson: PackTree['package'];

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-publish-test-'));
    pkgDir = path.join(testDir, 'packages', 'test-pkg');
    distDir = path.join(pkgDir, 'dist');

    fs.mkdirSync(pkgDir, { recursive: true });
    fs.mkdirSync(distDir, { recursive: true });

    pkgJson = {
      name: '@test/pkg',
      version: '1.0.0',
      files: ['dist/**/*', 'LICENSE', 'README.md'],
    };
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    fs.writeFileSync(path.join(pkgDir, 'LICENSE'), 'MIT License');
    fs.writeFileSync(path.join(pkgDir, 'README.md'), '# Test Package');
    fs.writeFileSync(path.join(distDir, 'index.js'), 'console.log("hello");');
    fs.writeFileSync(path.join(distDir, 'index.d.ts'), 'export function test(): void;');

    fs.mkdirSync(path.join(distDir, 'cjs'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'cjs', 'index.js'), 'module.exports = {};');

    fs.mkdirSync(path.join(distDir, 'esm'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'esm', 'index.js'), 'export default {};');

    // Should NOT be included
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'source.ts'), 'source code');
    fs.writeFileSync(path.join(pkgDir, '.gitignore'), '*.log');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should include all files specified in package.json files field', async () => {
    const includedFiles = await pack({ path: pkgDir, package: pkgJson });

    expect(includedFiles).toContain('README.md');
    expect(includedFiles).toContain('LICENSE');
    expect(includedFiles).toContain('dist/index.js');
    expect(includedFiles).toContain('dist/index.d.ts');
    expect(includedFiles).toContain('dist/cjs/index.js');
    expect(includedFiles).toContain('dist/esm/index.js');

    expect(includedFiles).not.toContain('src/source.ts');
    expect(includedFiles).not.toContain('.gitignore');

    const distFiles = includedFiles.filter((f) => f.startsWith('dist/'));
    expect(distFiles.length).toBe(4);

    const filesFieldFiles = includedFiles.filter((f) => f === 'README.md' || f === 'LICENSE' || f.startsWith('dist/'));
    expect(filesFieldFiles.length).toBe(6);
  });

  it('should respect glob patterns in files field', async () => {
    const includedFiles = await pack({ path: pkgDir, package: pkgJson });

    expect(includedFiles).toContain('dist/cjs/index.js');
    expect(includedFiles).toContain('dist/esm/index.js');
  });

  it('should handle missing files in files field', async () => {
    fs.unlinkSync(path.join(pkgDir, 'LICENSE'));

    const includedFiles = await pack({ path: pkgDir, package: pkgJson });

    expect(includedFiles).not.toContain('LICENSE');
    // 4 dist files + README.md + package.json
    expect(includedFiles.length).toBe(6);
  });
});
