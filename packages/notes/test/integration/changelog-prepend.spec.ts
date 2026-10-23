import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput, Config, PackageChangelog } from '../../src/core/types.js';

// `both` mode also writes per-package files under the detected workspace; keep it out of the real repo.
vi.mock('../../src/monorepo/aggregator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/monorepo/aggregator.js')>()),
  detectMonorepo: () => ({ isMonorepo: false, packagesPath: 'packages' }),
}));

const EXISTING = `# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-01

### Added
- Ancient history that must survive
`;

const SINGLE_PACKAGE_GOLDEN = `# Changelog

All notable changes to this project will be documented in this file.


## [1.1.0] - 2026-02-01

[Full Changelog](https://github.com/acme/repo/compare/1.0.0...1.1.0)

### Added
- feature

## [1.0.0] - 2026-01-01

### Added
- Ancient history that must survive
`;

function pkg(packageName: string, entries: PackageChangelog['entries']): PackageChangelog {
  return {
    packageName,
    version: '1.1.0',
    previousVersion: '1.0.0',
    revisionRange: 'v1.0.0..HEAD',
    repoUrl: 'https://github.com/acme/repo',
    date: '2026-02-01',
    entries,
  };
}

const twoPackages: ChangelogInput = {
  source: 'version',
  packages: [
    pkg('@x/a', [{ type: 'added', description: 'feature A', issueIds: ['#12'] }]),
    pkg('@x/b', [{ type: 'fixed', description: 'fix B' }]),
  ],
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-notes-prepend-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

async function writeChangelog(input: ChangelogInput, config: Config, existing?: string): Promise<string> {
  const file = path.join(dir, `CHANGELOG-${Math.random().toString(36).slice(2)}.md`);
  if (existing !== undefined) {
    fs.writeFileSync(file, existing, 'utf-8');
  }
  await runPipeline(input, { ...config, changelog: { ...config.changelog, file } }, false);
  return fs.readFileSync(file, 'utf-8');
}

describe('Pipeline: root changelog keeps its history', () => {
  it.each(['root', 'both'] as const)('should prepend every package section in %s mode', async (mode) => {
    const out = await writeChangelog(twoPackages, { changelog: { mode } }, EXISTING);

    expect(out.match(/^# Changelog$/gm)).toHaveLength(1);
    expect(out).toContain('- Ancient history that must survive');
    const a = out.indexOf('## [@x/a@1.1.0]');
    const b = out.indexOf('## [@x/b@1.1.0]');
    const old = out.indexOf('## [1.0.0]');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(old).toBeGreaterThan(b);
  });

  it('should format prepended sections exactly as a freshly written file does', async () => {
    const config: Config = { changelog: { mode: 'root', refs: 'strip' } };
    const fresh = await writeChangelog(twoPackages, config);
    const prepended = await writeChangelog(twoPackages, config, EXISTING);

    const freshSections = fresh.slice(fresh.indexOf('## [')).trimEnd();
    expect(prepended).toContain(freshSections);
    expect(prepended.indexOf(freshSections)).toBeLessThan(prepended.indexOf('## [1.0.0]'));
  });

  it('should keep a header-only file and add the sections after it', async () => {
    const header = '# Changelog\n\nOur own intro.\n';
    const out = await writeChangelog(twoPackages, { changelog: { mode: 'root' } }, header);

    expect(out.startsWith(header.trimEnd())).toBe(true);
    expect(out).toContain('## [@x/a@1.1.0]');
    expect(out).toContain('## [@x/b@1.1.0]');
  });

  it('should prepend above a first section that has no header before it', async () => {
    const existing = '## [1.0.0] - 2026-01-01\n\n### Added\n- Ancient history that must survive\n';
    const out = await writeChangelog(twoPackages, { changelog: { mode: 'root' } }, existing);

    expect(out.startsWith('## [@x/a@1.1.0]')).toBe(true);
    expect(out.indexOf('## [@x/b@1.1.0]')).toBeLessThan(out.indexOf('## [1.0.0]'));
    expect(out).toContain('- Ancient history that must survive');
  });

  it('should leave single-package prepend output unchanged', async () => {
    const single: ChangelogInput = {
      source: 'version',
      packages: [pkg('my-lib', [{ type: 'added', description: 'feature' }])],
    };
    const out = await writeChangelog(single, { changelog: { mode: 'root' } }, EXISTING);

    expect(out).toBe(SINGLE_PACKAGE_GOLDEN);
  });
});
