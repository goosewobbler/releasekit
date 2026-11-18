/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

function createRepo(versions: Record<string, string>, config: Record<string, unknown>) {
  const names = Object.keys(versions);
  tempDir = createWorkspaceRepo('rk-group-mode-', {
    packages: Object.fromEntries(names.map((name) => [name, name])),
    config: {
      preset: 'angular',
      versionPrefix: 'v',
      sync: false,
      packageSpecificTags: true,
      tagTemplate: '${packageName}/v${version}',
      ...config,
    },
  });
  for (const [name, version] of Object.entries(versions)) {
    createPackageJson(join(tempDir, 'packages', name), name, version);
  }
  execFileSync('git', ['commit', '-qam', 'chore: set versions'], { cwd: tempDir });
  for (const [name, version] of Object.entries(versions)) {
    execFileSync('git', ['tag', `${name}/v${version}`], { cwd: tempDir });
  }
}

function change(name: string, type: string) {
  writeFileSync(join(tempDir, 'packages', name, 'index.js'), `// ${type}\n`);
  createConventionalCommit(tempDir, type, `change ${name}`, undefined, false, [`packages/${name}`]);
}

function newVersions(output: ReturnType<typeof runVersionJson>): Record<string, string> {
  return Object.fromEntries(output.updates.map((u) => [u.packageName, u.newVersion]));
}

describe('group mode', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it.each(['linked', 'fixed'])(
    'should release a %s group at its highest baseline bumped by its largest change, in one release commit',
    (sync) => {
      createRepo({ core: '2.3.0', utils: '2.5.0' }, { groups: { lib: { packages: ['core', 'utils'], sync } } });
      change('core', 'feat');
      change('utils', 'fix');

      const output = runVersionJson(tempDir);
      expect(newVersions(output)).toEqual({ core: '2.6.0', utils: '2.6.0' });
      expect(output.commitMessage).toBe('chore: release core, utils v2.6.0');
    },
  );

  it("should start each package's changelog at its own tag", () => {
    createRepo(
      { core: '2.3.0', utils: '2.5.0', docs: '1.0.0' },
      { groups: { lib: { packages: ['core', 'utils'], sync: 'fixed' } } },
    );
    change('core', 'feat');
    change('utils', 'fix');
    change('docs', 'fix');

    const output = runVersionJson(tempDir);
    expect(
      Object.fromEntries(output.changelogs.map((c) => [c.packageName, [c.previousVersion, c.revisionRange]])),
    ).toEqual({
      core: ['core/v2.3.0', 'core/v2.3.0..HEAD'],
      utils: ['utils/v2.5.0', 'utils/v2.5.0..HEAD'],
      docs: ['docs/v1.0.0', 'docs/v1.0.0..HEAD'],
    });
  });

  it('should release only the targeted group', () => {
    createRepo(
      { core: '1.0.0', utils: '1.0.0', cli: '1.0.0', docs: '1.0.0' },
      { groups: { lib: { packages: ['core', 'utils'], sync: 'fixed' }, app: { packages: ['cli'], sync: 'fixed' } } },
    );
    for (const name of ['core', 'cli', 'docs']) {
      change(name, 'fix');
    }

    expect(newVersions(runVersionJson(tempDir, '--target core'))).toEqual({ core: '1.0.1', utils: '1.0.1' });
  });

  it('should leave out a skipped ungrouped package', () => {
    createRepo(
      { core: '1.0.0', docs: '1.0.0' },
      { groups: { lib: { packages: ['core'], sync: 'fixed' } }, skip: ['docs'] },
    );
    change('core', 'fix');
    change('docs', 'fix');

    expect(newVersions(runVersionJson(tempDir))).toEqual({ core: '1.0.1' });
  });
});
