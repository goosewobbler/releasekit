import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeForge, type FakeForge } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';
import { forgeFor } from '../../../src/github.js';

vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

// Logs the files it's given, then re-indents JSON with tabs and appends a `# formatted` line to the rest.
const FORMATTER = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const [log, ...files] = process.argv.slice(2);
appendFileSync(log, files.map((file) => file + '\\n').join(''));
for (const file of files) {
  const text = readFileSync(file, 'utf-8');
  writeFileSync(file, file.endsWith('.json') ? JSON.stringify(JSON.parse(text), null, '\\t') + '\\n' : text + '# formatted\\n');
}
`;

describe('git.formatCommand in a standing-PR update', () => {
  let root: string;
  let repo: string;
  let remote: string;
  let tools: string;
  let log: string;
  let originalCwd: string;
  let forge: FakeForge;

  beforeEach(() => {
    originalCwd = process.cwd();
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
    vi.stubEnv('GITHUB_EVENT_NAME', '');
    vi.stubEnv('GITHUB_EVENT_PATH', '');
    forge = createFakeForge();
    vi.mocked(forgeFor).mockReturnValue(forge);
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    root = realpathSync(mkdtempSync(join(tmpdir(), 'rk-standing-pr-format-')));
    repo = join(root, 'repo');
    remote = join(root, 'remote.git');
    tools = join(root, 'format tools');
    log = join(tools, 'formatted.log');
    mkdirSync(tools);
    writeFileSync(join(tools, 'format.mjs'), FORMATTER);
    writeFileSync(join(tools, 'fail.mjs'), "process.stderr.write('format check exploded\\n');\nprocess.exit(1);\n");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  function setUpRepo(formatCommand: string): void {
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'rk-pkg', version: '1.0.0' }, null, 2)}\n`);
    writeFileSync(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({
        git: { formatCommand },
        version: { versionPrefix: 'v' },
        ci: { releaseStrategy: 'standing-pr' },
      }),
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'chore: init');
    git(repo, 'tag', 'v1.0.0');
    writeFileSync(join(repo, 'feature.txt'), 'feature\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'feat: add a feature');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main', '--tags');
    // The conventional-commits bumper runs git in the process cwd, not the project dir.
    process.chdir(repo);
  }

  async function update(): Promise<{ status: string; errors: Array<{ code: string; message: string }> }> {
    const output = join(root, 'out.json');
    await createStandingPRCommand().parseAsync([
      'node',
      'standing-pr',
      'update',
      '--json',
      '--output',
      output,
      '--project-dir',
      repo,
    ]);
    return JSON.parse(readFileSync(output, 'utf-8'));
  }

  it('should push the release branch with every file the update wrote as the formatter left it', async () => {
    setUpRepo(`node "${join(tools, 'format.mjs')}" "${log}"`);

    const envelope = await update();

    expect(envelope).toMatchObject({ status: 'success', data: { action: 'created' } });
    expect(readFileSync(log, 'utf-8').split('\n').filter(Boolean).sort()).toEqual(['CHANGELOG.md', 'package.json']);
    expect(git(remote, 'show', 'release/next:package.json')).toBe('{\n\t"name": "rk-pkg",\n\t"version": "1.1.0"\n}');
    expect(git(remote, 'show', 'release/next:CHANGELOG.md')).toMatch(/1\.1\.0[\s\S]*# formatted$/);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('should fail with a config error and commit or push nothing when the formatter fails', async () => {
    const command = `node "${join(tools, 'fail.mjs')}"`;
    setUpRepo(command);

    const envelope = await update();

    expect(envelope.status).toBe('error');
    expect(envelope.errors).toMatchObject([
      { code: 'CONFIG_ERROR', message: `git.formatCommand \`${command}\` exited with code 1:\nformat check exploded` },
    ]);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'main'));
    expect(git(remote, 'branch', '--list', 'release/next')).toBe('');
    expect(forge.createdPullRequests).toEqual([]);
  });
});
