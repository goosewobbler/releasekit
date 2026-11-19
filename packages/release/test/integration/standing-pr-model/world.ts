import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StatefulForge } from './forge.js';
import { FakeRegistry } from './registry.js';

export const PACKAGES = ['rk-a', 'rk-b'] as const;
export type PackageName = (typeof PACKAGES)[number];
export const RELEASE_BRANCH = 'release/next';
export const RELEASE_PREFIX = 'chore: release ';
export const INITIAL_VERSION = '1.0.0';

export interface WorldConfig {
  sync: boolean;
  enforceMergeAuthor: boolean;
}

export function releaseKitConfig(config: WorldConfig): object {
  return {
    git: { branch: 'main' },
    version: {
      preset: 'angular',
      versionPrefix: 'v',
      sync: config.sync,
      ...(config.sync ? {} : { packageSpecificTags: true }),
    },
    publish: {
      npm: { enabled: true, access: 'public' },
      githubRelease: { enabled: false },
      verify: { npm: { enabled: false } },
    },
    ci: {
      releaseStrategy: 'standing-pr',
      standingPr: {
        branch: RELEASE_BRANCH,
        mergeMethod: 'squash',
        authorization: { requiredPermission: 'maintain', enforceMergeAuthor: config.enforceMergeAuthor },
      },
      labels: { retry: 'release:retry' },
    },
  };
}

export function tagFor(config: WorldConfig, pkg: string, version: string): string {
  return config.sync ? `v${version}` : `${pkg}@v${version}`;
}

/** What a workflow job sees. */
export interface JobEnv {
  eventName: string;
  event: object;
  sha: string;
  ref?: string;
}

/**
 * A repository on a bare `origin`, a fake registry and a stateful fake GitHub. Every job runs in a fresh clone, as CI
 * does, so nothing a job leaves locally (an unpushed tag, a dirty tree) leaks into the next.
 */
export class World {
  readonly forge: StatefulForge;
  readonly registry: FakeRegistry;
  readonly origin: string;
  /** Jobs that failed, for the report when an invariant breaks. */
  readonly log: string[] = [];
  private readonly scratch: string;
  private readonly jobDir: string;
  private clock = Math.floor(Date.now() / 1000);

  constructor(
    readonly root: string,
    readonly config: WorldConfig,
  ) {
    this.origin = path.join(root, 'origin.git');
    this.scratch = path.join(root, 'scratch');
    this.jobDir = path.join(root, 'job');
    this.registry = FakeRegistry.create(
      path.join(root, 'registry'),
      PACKAGES.map((pkg) => `${pkg}@${INITIAL_VERSION}`),
    );
    this.forge = new StatefulForge({
      branchSha: (branch) => this.branchSha(branch),
      squashMerge: (head, base, subject) => this.squashMerge(head, base, subject),
    });
  }

  static create(config: WorldConfig): World {
    // A job's cwd reports the real path, and macOS's tmpdir is behind a symlink.
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rk-standing-pr-model-')));
    const world = new World(root, config);
    world.init();
    return world;
  }

  dispose(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }

  git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }

  /** Tag ordering goes by creation date in whole seconds, so each step gets a later one. */
  tick(): void {
    this.clock += 2;
    const date = `${this.clock} +0000`;
    process.env.GIT_AUTHOR_DATE = date;
    process.env.GIT_COMMITTER_DATE = date;
  }

  private init(): void {
    this.tick();
    this.git(this.root, 'init', '-q', '--bare', '-b', 'main', this.origin);
    fs.mkdirSync(this.scratch);
    const write = (file: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(this.scratch, file)), { recursive: true });
      fs.writeFileSync(path.join(this.scratch, file), content);
    };
    write('package.json', `${JSON.stringify({ name: 'rk-model', private: true }, null, 2)}\n`);
    write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');
    write('releasekit.config.json', `${JSON.stringify(releaseKitConfig(this.config), null, 2)}\n`);
    for (const pkg of PACKAGES) {
      write(
        `packages/${pkg}/package.json`,
        `${JSON.stringify({ name: pkg, version: INITIAL_VERSION, files: ['index.js'] }, null, 2)}\n`,
      );
      write(`packages/${pkg}/index.js`, '// initial\n');
    }
    this.git(this.scratch, 'init', '-q', '-b', 'main');
    this.git(this.scratch, 'add', '-A');
    this.git(this.scratch, 'commit', '-qm', 'chore: init');
    const tags = new Set(PACKAGES.map((pkg) => tagFor(this.config, pkg, INITIAL_VERSION)));
    for (const tag of tags) {
      this.git(this.scratch, 'tag', '-a', tag, '-m', `Release ${tag}`);
    }
    this.git(this.scratch, 'remote', 'add', 'origin', this.origin);
    this.git(this.scratch, 'push', '-q', 'origin', 'main', '--tags');
  }

  branchSha(branch: string): string | null {
    try {
      return this.git(this.origin, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`);
    } catch {
      return null;
    }
  }

  mainSha(): string {
    const sha = this.branchSha('main');
    if (!sha) {
      throw new Error('origin has no main branch');
    }
    return sha;
  }

  remoteTags(): string[] {
    const out = this.git(this.origin, 'tag', '--list');
    return out ? out.split('\n') : [];
  }

  /** A feeder PR's commit, pushed straight to `main` as its merge. */
  commitToMain(subject: string, files: Record<string, string>): string {
    this.syncScratch('main');
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(this.scratch, file)), { recursive: true });
      fs.writeFileSync(path.join(this.scratch, file), content);
    }
    this.git(this.scratch, 'add', '-A');
    this.git(this.scratch, 'commit', '-qm', subject);
    this.git(this.scratch, 'push', '-q', 'origin', 'main');
    return this.git(this.scratch, 'rev-parse', 'HEAD');
  }

  private squashMerge(head: string, base: string, subject: string): string {
    this.syncScratch(base);
    try {
      this.git(this.scratch, 'merge', '-q', '--squash', `origin/${head}`);
    } catch (err) {
      this.git(this.scratch, 'reset', '-q', '--hard', `origin/${base}`);
      throw Object.assign(new Error(`Merge conflict: ${err instanceof Error ? err.message : String(err)}`), {
        status: 405,
      });
    }
    this.git(this.scratch, 'commit', '-q', '--allow-empty', '-m', subject);
    this.git(this.scratch, 'push', '-q', 'origin', base);
    return this.git(this.scratch, 'rev-parse', 'HEAD');
  }

  private syncScratch(branch: string): void {
    this.git(this.scratch, 'fetch', '-q', '--prune', 'origin');
    this.git(this.scratch, 'checkout', '-q', '-B', branch, `origin/${branch}`);
    this.git(this.scratch, 'reset', '-q', '--hard', `origin/${branch}`);
    this.git(this.scratch, 'clean', '-qfdx');
  }

  /** A CI job's checkout of `sha` as local `branch`, with every tag the remote has. Replaces the previous job's. */
  checkout(sha: string, branch = 'main'): string {
    this.park();
    this.git(this.root, 'clone', '-q', this.origin, this.jobDir);
    this.git(this.jobDir, 'checkout', '-q', '-B', branch, sha);
    return this.jobDir;
  }

  /** Removes the last job's checkout, so a long run holds one at a time. */
  park(): void {
    fs.rmSync(this.jobDir, { recursive: true, force: true });
    fs.rmSync(`${this.jobDir}.event.json`, { force: true });
  }

  /** Runs `fn` as a workflow job: GitHub's variables set, the checkout as cwd, and both restored afterwards. */
  async job<T>(dir: string, env: JobEnv, fn: () => Promise<T>): Promise<T> {
    const eventPath = `${dir}.event.json`;
    fs.writeFileSync(eventPath, JSON.stringify(env.event));
    const vars: Record<string, string> = {
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_TOKEN: 'fake-token',
      GITHUB_EVENT_NAME: env.eventName,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: env.sha,
      GITHUB_REF: env.ref ?? 'refs/heads/main',
      NPM_TOKEN: 'fake-npm-token',
      RK_FAKE_REGISTRY: this.registry.file,
      PATH: `${this.registry.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };
    const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
    const cwd = process.cwd();
    Object.assign(process.env, vars);
    process.chdir(dir);
    try {
      return await fn();
    } finally {
      process.chdir(cwd);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  versionsAt(rev: string): Record<string, string> {
    return Object.fromEntries(
      PACKAGES.map((pkg) => [
        pkg,
        JSON.parse(this.git(this.origin, 'show', `${rev}:packages/${pkg}/package.json`)).version as string,
      ]),
    );
  }

  subjects(range: string): Array<{ sha: string; subject: string }> {
    const out = this.git(this.origin, 'log', '--format=%H %s', range);
    return out ? out.split('\n').map((line) => ({ sha: line.slice(0, 40), subject: line.slice(41) })) : [];
  }
}
