import { describe, expect, it, vi } from 'vitest';
import { GitError, gitExitCode, isCommandNotFound, isExecTimeout, redactUrlCredentials } from '../../src/errors.js';
import { createGitCli, GitCli, type GitRunner } from '../../src/git.js';

interface RunOptions {
  cwd: string;
  ignoreOutput?: boolean;
  timeout?: number;
}

/** A recorded invocation: the argv git would have run, plus the per-call options. */
interface Call {
  args: string[];
  options: RunOptions;
}

/**
 * A hand-built {@link GitRunner} stand-in (the analogue of forge's `makeOctokit`). It records every
 * argv array, returns canned stdout/stderr, and can be told to reject — so a test asserts on the exact
 * arguments without spawning a real `git`.
 */
function makeRunner(responses: { stdout?: string; stderr?: string; reject?: unknown } = {}) {
  const calls: Call[] = [];
  const run: GitRunner = vi.fn(async (args, options) => {
    calls.push({ args, options });
    if (responses.reject !== undefined) throw responses.reject;
    return { stdout: responses.stdout ?? '', stderr: responses.stderr ?? '' };
  });
  return { run, calls };
}

/** A Node exec-style error: numeric `code` is an exit status; `stderr` carries git's message. */
const exitError = (code: number, stderr = '') => Object.assign(new Error(`exit ${code}`), { code, stderr });
/** A missing-binary spawn error. */
const enoent = () => Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
/** A timeout kill from execFile's `timeout` option. */
const timeoutKill = () => Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });

describe('GitCli queries', () => {
  it('should shell out for isRepository with an argv array and ignored stdio, true on clean exit', async () => {
    const { run, calls } = makeRunner();
    expect(await new GitCli(run).isRepository('/repo')).toBe(true);
    expect(calls[0].args).toEqual(['rev-parse', '--is-inside-work-tree']);
    expect(calls[0].options).toEqual({ cwd: '/repo', ignoreOutput: true });
  });

  it('should return false from isRepository when git exits non-zero', async () => {
    const { run } = makeRunner({ reject: exitError(128, 'not a git repository') });
    expect(await new GitCli(run).isRepository('/tmp')).toBe(false);
  });

  it('should throw from isRepository when the git binary is missing', async () => {
    const { run } = makeRunner({ reject: enoent() });
    await expect(new GitCli(run).isRepository()).rejects.toBeInstanceOf(GitError);
  });

  it('should trim the branch name from rev-parse --abbrev-ref HEAD', async () => {
    const { run, calls } = makeRunner({ stdout: 'release/next\n' });
    expect(await new GitCli(run).currentBranch('/r')).toBe('release/next');
    expect(calls[0].args).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
  });

  it('should trim the head sha from rev-parse HEAD', async () => {
    const { run, calls } = makeRunner({ stdout: 'abc123\n' });
    expect(await new GitCli(run).headSha()).toBe('abc123');
    expect(calls[0].args).toEqual(['rev-parse', 'HEAD']);
  });

  it('should return the remote url, trimmed', async () => {
    const { run, calls } = makeRunner({ stdout: 'git@github.com:o/r.git\n' });
    expect(await new GitCli(run).remoteUrl('origin', '/r')).toBe('git@github.com:o/r.git');
    expect(calls[0].args).toEqual(['remote', 'get-url', 'origin']);
  });

  it('should return null from remoteUrl when the remote is absent (non-zero exit)', async () => {
    const { run } = makeRunner({ reject: exitError(2, 'No such remote') });
    expect(await new GitCli(run).remoteUrl('upstream')).toBeNull();
  });

  it('should throw from remoteUrl when the git binary is missing', async () => {
    const { run } = makeRunner({ reject: enoent() });
    await expect(new GitCli(run).remoteUrl('origin')).rejects.toBeInstanceOf(GitError);
  });

  it('should list tags and pass --sort when given, splitting and dropping empties', async () => {
    const { run, calls } = makeRunner({ stdout: 'v1.0.0\nv1.1.0\n\n' });
    expect(await new GitCli(run).listTags({ sort: '-creatordate' })).toEqual(['v1.0.0', 'v1.1.0']);
    expect(calls[0].args).toEqual(['tag', '--sort=-creatordate']);
  });

  it('should list tags without --sort when none is given', async () => {
    const { run, calls } = makeRunner({ stdout: 'v1\n' });
    await new GitCli(run).listTags();
    expect(calls[0].args).toEqual(['tag']);
  });

  it('should return the nearest tag from describe, trimmed', async () => {
    const { run, calls } = makeRunner({ stdout: 'v2.0.0\n' });
    expect(await new GitCli(run).describeTags('/r')).toBe('v2.0.0');
    expect(calls[0].args).toEqual(['describe', '--tags', '--abbrev=0']);
  });

  it('should return null from describeTags when there is no reachable tag (non-zero exit)', async () => {
    const { run } = makeRunner({ reject: exitError(128, 'No names found') });
    expect(await new GitCli(run).describeTags()).toBeNull();
  });

  it('should verify a ref with the ^{commit} peel and ignored stdio, true on clean exit', async () => {
    const { run, calls } = makeRunner();
    expect(await new GitCli(run).refExists('v1.0.0', '/r')).toBe(true);
    expect(calls[0].args).toEqual(['rev-parse', '--verify', '--quiet', 'v1.0.0^{commit}']);
    expect(calls[0].options.ignoreOutput).toBe(true);
  });

  it('should return false from refExists when the ref does not resolve', async () => {
    const { run } = makeRunner({ reject: exitError(1) });
    expect(await new GitCli(run).refExists('missing')).toBe(false);
  });

  it('should answer isAncestor via merge-base --is-ancestor exit code', async () => {
    const ok = makeRunner();
    expect(await new GitCli(ok.run).isAncestor('a', 'b', '/r')).toBe(true);
    expect(ok.calls[0].args).toEqual(['merge-base', '--is-ancestor', 'a', 'b']);

    const no = makeRunner({ reject: exitError(1) });
    expect(await new GitCli(no.run).isAncestor('a', 'b')).toBe(false);
  });

  it('should count commits, appending the path after -- when given', async () => {
    const { run, calls } = makeRunner({ stdout: '7\n' });
    expect(await new GitCli(run).countCommits('v1..HEAD', { path: 'packages/git' })).toBe(7);
    expect(calls[0].args).toEqual(['rev-list', '--count', 'v1..HEAD', '--', 'packages/git']);
  });

  it('should count commits without a path and default unparseable output to 0', async () => {
    const { run, calls } = makeRunner({ stdout: '\n' });
    expect(await new GitCli(run).countCommits('v1..HEAD')).toBe(0);
    expect(calls[0].args).toEqual(['rev-list', '--count', 'v1..HEAD']);
  });

  it('should build a git log argv with format, extraArgs, range, and paths in order', async () => {
    const { run, calls } = makeRunner({ stdout: 'raw log\n' });
    const out = await new GitCli(run).log({
      format: '%H %s',
      extraArgs: ['--no-merges'],
      range: 'v1..HEAD',
      paths: ['a.ts', 'b.ts'],
      cwd: '/r',
    });
    expect(out).toBe('raw log\n');
    expect(calls[0].args).toEqual(['log', '--format=%H %s', '--no-merges', 'v1..HEAD', '--', 'a.ts', 'b.ts']);
  });

  it('should omit format/range/paths from git log when not provided', async () => {
    const { run, calls } = makeRunner({ stdout: '' });
    await new GitCli(run).log({});
    expect(calls[0].args).toEqual(['log']);
  });

  it('should list changed paths from diff-tree, splitting and dropping empties', async () => {
    const { run, calls } = makeRunner({ stdout: 'a.ts\nb.ts\n\n' });
    expect(await new GitCli(run).diffTreeNames('sha1', '/r')).toEqual(['a.ts', 'b.ts']);
    expect(calls[0].args).toEqual(['diff-tree', '--no-commit-id', '--name-only', '-r', 'sha1']);
  });

  it('should run for-each-ref with format, and append sort/pattern when given', async () => {
    const { run, calls } = makeRunner({ stdout: 'v1 sha1\nv2 sha2\n' });
    expect(
      await new GitCli(run).forEachRef({
        format: '%(refname) %(objectname)',
        sort: '-creatordate',
        pattern: 'refs/tags/v*',
      }),
    ).toEqual(['v1 sha1', 'v2 sha2']);
    expect(calls[0].args).toEqual([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      '--sort=-creatordate',
      'refs/tags/v*',
    ]);
  });

  it('should answer remoteBranchExists via ls-remote --exit-code exit code', async () => {
    const yes = makeRunner();
    expect(await new GitCli(yes.run).remoteBranchExists('origin', 'release/next', '/r')).toBe(true);
    expect(yes.calls[0].args).toEqual([
      'ls-remote',
      '--exit-code',
      '--heads',
      '--end-of-options',
      'origin',
      'release/next',
    ]);

    const no = makeRunner({ reject: exitError(2) });
    expect(await new GitCli(no.run).remoteBranchExists('origin', 'absent')).toBe(false);
  });
});

describe('GitCli mutations', () => {
  it('should stage explicit paths after --', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).add(['a.ts', 'b.ts'], '/r');
    expect(calls[0].args).toEqual(['add', '--', 'a.ts', 'b.ts']);
  });

  it('should stage a literal "-A" path after -- rather than treating it as a flag', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).add(['-A']);
    expect(calls[0].args).toEqual(['add', '--', '-A']);
  });

  it('should stage everything with add -A via addAll', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).addAll('/r');
    expect(calls[0].args).toEqual(['add', '-A']);
  });

  it('should commit with -m and append --no-verify and pathspecs when requested', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).commit('chore: release', { skipHooks: true, paths: ['CHANGELOG.md'], cwd: '/r' });
    expect(calls[0].args).toEqual(['commit', '-m', 'chore: release', '--no-verify', '--', 'CHANGELOG.md']);
  });

  it('should commit with a bare -m when no options are given', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).commit('feat: x');
    expect(calls[0].args).toEqual(['commit', '-m', 'feat: x']);
  });

  it('should create an annotated tag when a message is given', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).tag('v1.0.0', { message: 'release v1.0.0', cwd: '/r' });
    expect(calls[0].args).toEqual(['tag', '-a', 'v1.0.0', '-m', 'release v1.0.0']);
  });

  it('should create a lightweight tag when no message is given', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).tag('v1.0.0');
    expect(calls[0].args).toEqual(['tag', 'v1.0.0']);
  });

  it('should fetch from the named remote', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).fetch('origin', { cwd: '/r' });
    expect(calls[0].args).toEqual(['fetch', '--end-of-options', 'origin']);
  });

  it('should checkout a ref, using -B when create is set', async () => {
    const plain = makeRunner();
    await new GitCli(plain.run).checkout('main');
    expect(plain.calls[0].args).toEqual(['checkout', 'main']);

    const create = makeRunner();
    await new GitCli(create.run).checkout('release/next', { create: true });
    expect(create.calls[0].args).toEqual(['checkout', '-B', 'release/next']);
  });

  it('should hard-reset to a ref', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).resetHard('origin/main', '/r');
    expect(calls[0].args).toEqual(['reset', '--hard', 'origin/main']);
  });

  it('should run status, adding --porcelain and pathspecs when requested', async () => {
    const { run, calls } = makeRunner({ stdout: ' M a.ts\n' });
    expect(await new GitCli(run).status({ porcelain: true, paths: ['a.ts'] })).toBe(' M a.ts\n');
    expect(calls[0].args).toEqual(['status', '--porcelain', '--', 'a.ts']);
  });

  it('should run a bare status when no options are given', async () => {
    const { run, calls } = makeRunner({ stdout: 'clean\n' });
    await new GitCli(run).status();
    expect(calls[0].args).toEqual(['status']);
  });
});

describe('GitCli.push', () => {
  it('should push the remote and ref and pass the default timeout to execFile', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).push({ remote: 'origin', ref: 'HEAD:release/next', cwd: '/r' });
    expect(calls[0].args).toEqual(['push', '--end-of-options', 'origin', 'HEAD:release/next']);
    expect(calls[0].options.timeout).toBe(120_000);
  });

  it('should pass an explicit timeoutMs through to the runner timeout option', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).push({ remote: 'origin', timeoutMs: 5_000 });
    expect(calls[0].options.timeout).toBe(5_000);
  });

  it('should prefer --force-with-lease over --force and include --tags', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).push({ remote: 'origin', force: true, forceWithLease: true, tags: true });
    expect(calls[0].args).toEqual(['push', '--force-with-lease', '--tags', '--end-of-options', 'origin']);
  });

  it('should use --force when only force is set', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).push({ remote: 'origin', force: true, ref: 'main' });
    expect(calls[0].args).toEqual(['push', '--force', '--end-of-options', 'origin', 'main']);
  });

  it('should throw a GitError noting the timeout when the push is killed', async () => {
    const { run } = makeRunner({ reject: timeoutKill() });
    await expect(new GitCli(run).push({ remote: 'origin', timeoutMs: 10 })).rejects.toThrow(/timed out after 10ms/);
  });
});

describe('GitCli option-injection guard', () => {
  it('should refuse a leading-dash remote in fetch and never call the runner', async () => {
    const { run } = makeRunner();
    await expect(new GitCli(run).fetch('--upload-pack=evil')).rejects.toBeInstanceOf(GitError);
    expect(run).not.toHaveBeenCalled();
  });

  it('should refuse a leading-dash ref in checkout and never call the runner', async () => {
    const { run } = makeRunner();
    await expect(new GitCli(run).checkout('-malicious')).rejects.toThrow(/looks like an option/);
    expect(run).not.toHaveBeenCalled();
  });

  it('should refuse a leading-dash tag name and never call the runner', async () => {
    const { run } = makeRunner();
    await expect(new GitCli(run).tag('--force')).rejects.toBeInstanceOf(GitError);
    expect(run).not.toHaveBeenCalled();
  });

  it('should refuse a leading-dash branch in remoteBranchExists and never call the runner', async () => {
    const { run } = makeRunner();
    await expect(new GitCli(run).remoteBranchExists('origin', '--output=evil')).rejects.toBeInstanceOf(GitError);
    expect(run).not.toHaveBeenCalled();
  });

  it('should refuse a leading-dash remote in push and never call the runner', async () => {
    const { run } = makeRunner();
    await expect(new GitCli(run).push({ remote: '--receive-pack=evil' })).rejects.toBeInstanceOf(GitError);
    expect(run).not.toHaveBeenCalled();
  });

  it('should refuse a leading-dash commit in diffTreeNames and never call the runner', async () => {
    const { run } = makeRunner();
    await expect(new GitCli(run).diffTreeNames('--output=evil')).rejects.toBeInstanceOf(GitError);
    expect(run).not.toHaveBeenCalled();
  });

  it('should refuse a leading-dash pattern in forEachRef and never call the runner', async () => {
    const { run } = makeRunner();
    await expect(new GitCli(run).forEachRef({ format: '%(refname)', pattern: '--evil' })).rejects.toBeInstanceOf(
      GitError,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('should still run a normal value through the guard unharmed', async () => {
    const { run, calls } = makeRunner();
    await new GitCli(run).fetch('origin');
    expect(calls[0].args).toEqual(['fetch', '--end-of-options', 'origin']);
  });
});

describe('GitError mapping', () => {
  it('should wrap an unexpected failure in a GitError carrying argv, exit code, and stderr', async () => {
    const { run } = makeRunner({ reject: exitError(128, 'fatal: bad object\n') });
    const error = await new GitCli(run).headSha().catch((e) => e as GitError);
    expect(error).toBeInstanceOf(GitError);
    expect(error.args).toEqual(['rev-parse', 'HEAD']);
    expect(error.exitCode).toBe(128);
    expect(error.stderr).toBe('fatal: bad object');
    expect(error.message).toContain('fatal: bad object');
  });

  it('should redact URL userinfo in a push failure message, argv, and stderr', async () => {
    const remote = 'https://x-access-token:SECRETTOKEN@github.com/o/r.git';
    const { run } = makeRunner({
      reject: exitError(128, `fatal: unable to access '${remote}/': The requested URL returned error: 403`),
    });
    const error = await new GitCli(run).push({ remote, ref: 'main' }).catch((e) => e as GitError);
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).not.toContain('SECRETTOKEN');
    expect(error.stderr).not.toContain('SECRETTOKEN');
    expect(error.args.join(' ')).not.toContain('SECRETTOKEN');
    expect(error.message).toContain('https://***@github.com/o/r.git');
  });
});

describe('redactUrlCredentials', () => {
  it('should mask user:password userinfo while leaving credential-free URLs intact', () => {
    expect(redactUrlCredentials('https://x-access-token:tok@github.com/o/r')).toBe('https://***@github.com/o/r');
    expect(redactUrlCredentials('git push https://user:pw@host/a failed: https://user:pw@host/a')).toBe(
      'git push https://***@host/a failed: https://***@host/a',
    );
    // No userinfo → unchanged; scp-style remotes have no scheme:// and carry no inline secret.
    expect(redactUrlCredentials('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(redactUrlCredentials('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
  });

  it('should scan a long adversarial input linearly (no polynomial-regex ReDoS)', () => {
    // A long scheme-like run with no `://…@` span must return promptly and unchanged; the fixed
    // `://` anchor + negated class give a linear scan (guards the CodeQL polynomial-regex alert).
    const long = 'a'.repeat(200_000);
    expect(redactUrlCredentials(long)).toBe(long);
  });
});

describe('createGitCli', () => {
  it('should build a GitCli', () => {
    expect(createGitCli()).toBeInstanceOf(GitCli);
  });

  it('should route through an injected runner', async () => {
    const { run, calls } = makeRunner({ stdout: 'main\n' });
    expect(await createGitCli(run).currentBranch()).toBe('main');
    expect(calls).toHaveLength(1);
  });

  it('should default cwd to process.cwd() when none is given', async () => {
    const { run, calls } = makeRunner({ stdout: 'sha\n' });
    await createGitCli(run).headSha();
    expect(calls[0].options.cwd).toBe(process.cwd());
  });
});

describe('error helpers', () => {
  it('should read a numeric exit code and ignore a string code (ENOENT)', () => {
    expect(gitExitCode(exitError(128))).toBe(128);
    expect(gitExitCode(enoent())).toBeUndefined();
    expect(gitExitCode(new Error('plain'))).toBeUndefined();
  });

  it('should detect a missing binary via ENOENT only', () => {
    expect(isCommandNotFound(enoent())).toBe(true);
    expect(isCommandNotFound(exitError(1))).toBe(false);
    expect(isCommandNotFound(undefined)).toBe(false);
  });

  it('should detect a timeout via killed', () => {
    expect(isExecTimeout(timeoutKill())).toBe(true);
    expect(isExecTimeout(exitError(1))).toBe(false);
    expect(isExecTimeout(null)).toBe(false);
  });
});
