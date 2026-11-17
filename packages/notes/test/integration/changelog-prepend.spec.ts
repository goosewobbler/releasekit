import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNotesCommand } from '../../src/command.js';
import { runPipeline } from '../../src/core/pipeline.js';
import type { ChangelogInput, Config, PackageChangelog, TemplateContext } from '../../src/core/types.js';
import { writeMonorepoChangelogs } from '../../src/monorepo/aggregator.js';
import { renderMarkdown } from '../../src/output/markdown.js';

const HEADER = `# Changelog

All notable changes to this project will be documented in this file.
`;

const OLD_RELEASE = `## [1.0.0] - 2026-01-01

### Added

- Ancient history that must survive
`;

const EXISTING = `${HEADER}\n${OLD_RELEASE}`;

const DEFAULT_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`;

const NEW_RELEASE = `## [1.1.0] - 2026-02-01

[Full Changelog](https://github.com/acme/repo/compare/1.0.0...1.1.0)

### Added

- feature
`;

function pkg(packageName: string, entries: PackageChangelog['entries'], version = '1.1.0'): PackageChangelog {
  return {
    packageName,
    version,
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
    const out = await writeChangelog(twoPackages, { changelog: { mode: 'root' } }, OLD_RELEASE);

    expect(out.startsWith('## [@x/a@1.1.0]')).toBe(true);
    expect(out.indexOf('## [@x/b@1.1.0]')).toBeLessThan(out.indexOf('## [1.0.0]'));
    expect(out).toContain('- Ancient history that must survive');
  });

  it.each([
    ['a header and releases', EXISTING, `${HEADER}\n${NEW_RELEASE}\n${OLD_RELEASE}`],
    ['releases and no header', OLD_RELEASE, `${NEW_RELEASE}\n${OLD_RELEASE}`],
    ['a header and no releases', HEADER, `${HEADER}\n${NEW_RELEASE}`],
    ['no content', '', `${DEFAULT_HEADER}\n${NEW_RELEASE}`],
  ])('should keep standard Markdown spacing when prepending to a file with %s', async (_, existing, expected) => {
    const single: ChangelogInput = {
      source: 'version',
      packages: [pkg('my-lib', [{ type: 'added', description: 'feature' }])],
    };
    const out = await writeChangelog(single, { changelog: { mode: 'root' } }, existing);

    expect(out).toBe(expected);
  });
});

describe('writeMonorepoChangelogs: per-package changelogs keep their history', () => {
  it.each([
    ['a header', EXISTING],
    ['no header', OLD_RELEASE],
  ])('should prepend the new section to a file with %s', (_, existing) => {
    const pkgDir = path.join(dir, 'packages', 'a');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@x/a' }));
    const file = path.join(pkgDir, 'CHANGELOG.md');
    fs.writeFileSync(file, existing);
    const context: TemplateContext = {
      packageName: '@x/a',
      version: '1.1.0',
      previousVersion: '1.0.0',
      date: '2026-02-01',
      repoUrl: null,
      entries: [{ type: 'added', description: 'feature A' }],
    };

    writeMonorepoChangelogs([context], { rootPath: dir, packagesPath: 'packages' }, renderMarkdown, false);

    const out = fs.readFileSync(file, 'utf-8');
    const added = out.indexOf('## [1.1.0]');
    expect(added).toBeGreaterThan(-1);
    expect(added).toBeLessThan(out.indexOf('## [1.0.0]'));
    expect(out).toContain('- Ancient history that must survive');
  });
});

const CUSTOM_TEMPLATE = `# Custom header

{% for v in versions %}## {{ v.packageName }} {{ v.version }} (custom)

{% for e in v.entries %}- {{ e.description }}
{% endfor %}
{% endfor %}`;

function writeTemplate(): string {
  const file = path.join(dir, 'changelog.liquid');
  fs.writeFileSync(file, CUSTOM_TEMPLATE);
  return file;
}

function single(version: string): ChangelogInput {
  return {
    source: 'version',
    packages: [pkg('my-lib', [{ type: 'added', description: `feature ${version}` }], version)],
  };
}

describe('Pipeline: custom changelog templates prepend', () => {
  it('should add each run under the existing header and keep every prior section', async () => {
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, EXISTING);
    const config: Config = { changelog: { mode: 'root', file, templates: { path: writeTemplate() } } };

    await runPipeline(single('1.1.0'), config, false);
    await runPipeline(single('1.2.0'), config, false);

    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toBe(
      `${HEADER}\n## my-lib 1.2.0 (custom)\n\n- feature 1.2.0\n\n## my-lib 1.1.0 (custom)\n\n- feature 1.1.0\n\n${OLD_RELEASE}`,
    );
  });

  it('should write the whole rendered template to a new file', async () => {
    const out = await writeChangelog(single('1.1.0'), {
      changelog: { mode: 'root', templates: { path: writeTemplate() } },
    });

    expect(out.startsWith('# Custom header\n\n## my-lib 1.1.0 (custom)')).toBe(true);
  });

  it.each(['keep-a-changelog', 'angular'])('should prepend with the bundled %s template', async (name) => {
    const templatePath = fileURLToPath(new URL(`../../templates/${name}`, import.meta.url));
    const config: Config = { changelog: { mode: 'root', templates: { path: templatePath } } };

    const out = await writeChangelog(single('1.1.0'), config, EXISTING);

    expect(out.match(/^# Changelog$/gm)).toHaveLength(1);
    expect(out.startsWith(HEADER.trimEnd())).toBe(true);
    const added = out.indexOf('## [1.1.0] - 2026-02-01');
    expect(added).toBeGreaterThan(-1);
    expect(out.indexOf('- feature 1.1.0')).toBeGreaterThan(added);
    expect(out.indexOf('## [1.0.0]')).toBeGreaterThan(out.indexOf('- feature 1.1.0'));
    expect(out).toContain('- Ancient history that must survive');
  });
});

describe('Per-package changelogs with a custom template', () => {
  const originalCwd = process.cwd();
  let pkgFile: string;

  const monorepoInput: ChangelogInput = {
    source: 'version',
    packages: [pkg('@x/a', [{ type: 'added', description: 'feature A' }])],
  };

  beforeEach(() => {
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    const pkgDir = path.join(dir, 'packages', 'a');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@x/a' }));
    pkgFile = path.join(pkgDir, 'CHANGELOG.md');
    fs.writeFileSync(pkgFile, EXISTING);
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  const expected = `${HEADER}\n## @x/a 1.1.0 (custom)\n\n- feature A\n\n${OLD_RELEASE}`;

  it.each([
    ['packages', false],
    ['both', true],
  ] as const)('should render and prepend each package file in %s mode', async (mode, writesRoot) => {
    await runPipeline(monorepoInput, { changelog: { mode, templates: { path: writeTemplate() } } }, false);

    expect(fs.readFileSync(pkgFile, 'utf-8')).toBe(expected);
    expect(fs.existsSync(path.join(dir, 'CHANGELOG.md'))).toBe(writesRoot);
  });

  it('should honour --template in packages mode', async () => {
    const inputFile = path.join(dir, 'version-output.json');
    const changelogs = monorepoInput.packages.map(({ date: _, ...changelog }) => changelog);
    fs.writeFileSync(inputFile, JSON.stringify({ changelogs }));

    await createNotesCommand().parseAsync([
      'node',
      'test',
      'generate',
      '-i',
      inputFile,
      '--changelog-mode',
      'packages',
      '--template',
      writeTemplate(),
      '--no-llm',
    ]);

    expect(fs.readFileSync(pkgFile, 'utf-8')).toBe(expected);
  });
});
