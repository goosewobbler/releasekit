import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { VersionChangelogEntry } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processInput } from '../../src/core/pipeline.js';

const SHARED_PACKAGE: VersionChangelogEntry = { type: 'fix', description: 'Fix the bundled core', sharedPackage: true };
const REPO_LEVEL: VersionChangelogEntry = { type: 'ci', description: 'Pin the CI runner' };

const PACKAGE_BLOCK = '### Project-wide changes\n\n#### Fixed\n\n- Fix the bundled core\n';

function versionOutput(
  sharedEntries: VersionChangelogEntry[],
  ownEntries: Record<string, VersionChangelogEntry[]> = {},
): string {
  return JSON.stringify({
    dryRun: false,
    updates: [],
    tags: [],
    changelogs: ['a', 'b'].map((name) => ({
      packageName: `@x/${name}`,
      version: '1.1.0',
      previousVersion: '1.0.0',
      revisionRange: `@x/${name}@v1.0.0..HEAD`,
      repoUrl: null,
      entries: ownEntries[name] ?? [{ type: 'fix', description: `Fix ${name}` }],
    })),
    sharedEntries,
  });
}

const originalCwd = process.cwd();
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-notes-shared-'));
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  for (const name of ['a', 'b']) {
    fs.mkdirSync(path.join(dir, 'packages', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages', name, 'package.json'), JSON.stringify({ name: `@x/${name}` }));
  }
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

function packageChangelog(name: string): string {
  return fs.readFileSync(path.join(dir, 'packages', name, 'CHANGELOG.md'), 'utf-8');
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('Shared entries in notes output', () => {
  it("should list a shared-package entry in every package's changelog, notes file and release body, and a repo-level entry in none", async () => {
    const result = await processInput(
      versionOutput([SHARED_PACKAGE, REPO_LEVEL]),
      { changelog: { mode: 'packages' }, releaseNotes: { file: { dir: 'release-notes' } } },
      false,
    );

    const notesFiles = result.files.filter((file) => file.includes('release-notes'));
    expect(notesFiles).toHaveLength(2);
    const outputs = [
      packageChangelog('a'),
      packageChangelog('b'),
      ...notesFiles.map((file) => fs.readFileSync(path.resolve(dir, file), 'utf-8')),
      ...Object.values(result.releaseNotes ?? {}),
    ];
    expect(outputs).toHaveLength(6);
    for (const output of outputs) {
      expect(output).toContain(PACKAGE_BLOCK);
      expect(output).not.toContain('Pin the CI runner');
    }
  });

  it("should list a package's recorded shared-package entries, not the run's", async () => {
    const output = JSON.parse(versionOutput([SHARED_PACKAGE]));
    output.changelogs[0].sharedPackageEntries = [SHARED_PACKAGE];
    output.changelogs[1].sharedPackageEntries = [];

    await processInput(JSON.stringify(output), { changelog: { mode: 'packages' } }, false);

    expect(packageChangelog('a')).toContain(PACKAGE_BLOCK);
    expect(packageChangelog('b')).not.toContain('Fix the bundled core');
  });

  it("should not repeat a shared-package entry in the shared package's own notes", async () => {
    const result = await processInput(
      versionOutput([SHARED_PACKAGE], { a: [{ type: 'fix', description: 'Fix the bundled core' }] }),
      { changelog: { mode: 'packages' }, releaseNotes: {} },
      false,
    );

    expect(occurrences(packageChangelog('a'), 'Fix the bundled core')).toBe(1);
    expect(occurrences(result.releaseNotes?.['@x/a'] ?? '', 'Fix the bundled core')).toBe(1);
    expect(packageChangelog('b')).toContain(PACKAGE_BLOCK);
  });

  it("should leave a released shared package's own entries out of the root changelog's project-wide block", async () => {
    await processInput(
      versionOutput([SHARED_PACKAGE, REPO_LEVEL], { a: [{ type: 'fix', description: 'Fix the bundled core' }] }),
      { changelog: { mode: 'root' } },
      false,
    );

    const root = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf-8');
    expect(occurrences(root, 'Fix the bundled core')).toBe(1);
    expect(root).toMatch(/## Project-wide changes - \d{4}-\d{2}-\d{2}\n\n### Changed\n\n- Pin the CI runner\n$/);
  });

  it('should list each shared entry once in a root changelog, after the versions', async () => {
    await processInput(versionOutput([SHARED_PACKAGE, REPO_LEVEL]), { changelog: { mode: 'root' } }, false);

    const root = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf-8');
    expect(root).toMatch(
      /\n## Project-wide changes - \d{4}-\d{2}-\d{2}\n\n### Changed\n\n- Pin the CI runner\n\n### Fixed\n\n- Fix the bundled core\n$/,
    );
    expect(occurrences(root, 'Fix the bundled core')).toBe(1);
    expect(occurrences(root, 'Pin the CI runner')).toBe(1);
  });

  it('should read shared entries without the marker as repo-level', async () => {
    const { sharedPackage: _, ...unmarked } = SHARED_PACKAGE;

    await processInput(versionOutput([unmarked]), { changelog: { mode: 'both' } }, false);

    expect(packageChangelog('a')).not.toContain('Fix the bundled core');
    expect(packageChangelog('b')).not.toContain('Fix the bundled core');
    expect(occurrences(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf-8'), 'Fix the bundled core')).toBe(1);
  });
});
