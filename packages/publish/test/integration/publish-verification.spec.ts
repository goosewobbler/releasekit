import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// npm-packlist is what `npm pack` uses internally, called in-process: a cold
// `npm pack --dry-run` subprocess takes ~4-5s on CI, brushing the 5s test timeout.
// @ts-expect-error - npm-packlist ships no type declarations.
import packlist from 'npm-packlist';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface PackTree {
  path: string;
  package: { name: string; version: string; files?: string[] };
}

// npm-packlist's documented API takes an Arborist node, but for plain packages (a
// `files` field, no workspaces, no bundleDependencies) it reads only `node.path` and
// `node.package`, so a minimal POJO avoids depending on @npmcli/arborist.
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
