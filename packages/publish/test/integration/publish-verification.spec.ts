import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execCommand } from '../../src/utils/exec';

describe('Package Content Verification', () => {
  let testDir: string;
  let pkgDir: string;
  let distDir: string;

  beforeEach(() => {
    // Create temporary test directory structure
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-publish-test-'));
    pkgDir = path.join(testDir, 'packages', 'test-pkg');
    distDir = path.join(pkgDir, 'dist');

    fs.mkdirSync(pkgDir, { recursive: true });
    fs.mkdirSync(distDir, { recursive: true });

    // Create package.json with files field
    const packageJson = {
      name: '@test/pkg',
      version: '1.0.0',
      files: ['dist/**/*', 'LICENSE', 'README.md'],
    };
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(packageJson, null, 2));

    // Create the files that should be included
    fs.writeFileSync(path.join(pkgDir, 'LICENSE'), 'MIT License');
    fs.writeFileSync(path.join(pkgDir, 'README.md'), '# Test Package');
    fs.writeFileSync(path.join(distDir, 'index.js'), 'console.log("hello");');
    fs.writeFileSync(path.join(distDir, 'index.d.ts'), 'export function test(): void;');

    // Create subdirectories and files
    fs.mkdirSync(path.join(distDir, 'cjs'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'cjs', 'index.js'), 'module.exports = {};');

    fs.mkdirSync(path.join(distDir, 'esm'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'esm', 'index.js'), 'export default {};');

    // Create files that should NOT be included
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'source.ts'), 'source code');
    fs.writeFileSync(path.join(pkgDir, '.gitignore'), '*.log');
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should include all files specified in package.json files field', async () => {
    // Run npm pack to create tarball from the package directory
    const packResult = await execCommand('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgDir,
      dryRun: false,
    });

    // Parse the JSON output to get list of included files
    const output = packResult.stdout + packResult.stderr;
    const jsonMatch = output.match(/\[.*\]/s); // Find JSON array in output
    expect(jsonMatch).toBeTruthy();

    const packData = JSON.parse(jsonMatch![0]);
    expect(packData).toHaveLength(1);
    expect(packData[0].files).toBeDefined();

    // Extract files from the JSON structure
    const includedFiles = packData[0].files.map((file: any) => file.path);

    // Verify expected files are included
    expect(includedFiles).toContain('README.md');
    expect(includedFiles).toContain('LICENSE');
    expect(includedFiles).toContain('dist/index.js');
    expect(includedFiles).toContain('dist/index.d.ts');
    expect(includedFiles).toContain('dist/cjs/index.js');
    expect(includedFiles).toContain('dist/esm/index.js');

    // Verify files that should NOT be included are excluded
    expect(includedFiles).not.toContain('src/source.ts');
    expect(includedFiles).not.toContain('.gitignore');

    // Verify we have the expected number of files from the files field
    const distFiles = includedFiles.filter((file) => file.startsWith('dist/'));
    expect(distFiles.length).toBe(4); // index.js, index.d.ts, cjs/index.js, esm/index.js

    // npm pack includes package.json by default, so expect at least the files field + package.json
    const filesFieldFiles = includedFiles.filter(
      (file) => file === 'README.md' || file === 'LICENSE' || file.startsWith('dist/'),
    );
    expect(filesFieldFiles.length).toBe(6); // 4 dist files + LICENSE + README.md
  });

  it('should respect glob patterns in files field', async () => {
    // Test that glob patterns like "dist/**/*" work correctly
    const packResult = await execCommand('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgDir,
      dryRun: false,
    });

    const output = packResult.stdout + packResult.stderr;
    const jsonMatch = output.match(/\[.*\]/s);
    expect(jsonMatch).toBeTruthy();

    const packData = JSON.parse(jsonMatch![0]);
    const includedFiles = packData[0].files
      .map((file: any) => file.path)
      .filter((path: string) => path.includes('dist/'));

    // Should include files in subdirectories due to **/* glob
    expect(includedFiles).toContain('dist/cjs/index.js');
    expect(includedFiles).toContain('dist/esm/index.js');
  });

  it('should handle missing files in files field', async () => {
    // Remove a required file and verify the pack includes fewer files
    fs.unlinkSync(path.join(pkgDir, 'LICENSE'));

    const packResult = await execCommand('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgDir,
      dryRun: false,
    });

    const output = packResult.stdout + packResult.stderr;
    const jsonMatch = output.match(/\[.*\]/s);
    expect(jsonMatch).toBeTruthy();

    const packData = JSON.parse(jsonMatch![0]);
    const includedFiles = packData[0].files.map((file: any) => file.path);

    // Should have one fewer file from the files field since LICENSE was removed
    expect(includedFiles).not.toContain('LICENSE');
    expect(includedFiles.length).toBe(6); // 4 dist files + README.md + package.json
  });
});
