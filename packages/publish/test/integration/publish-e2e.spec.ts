/**
 * End-to-end coverage of the NON-dry-run publish pipeline.
 *
 * Every other test layer bypasses the real publish path — Examples Smoke runs `--dry-run` (registry
 * auth is dry-run-exempt), the Action harness sets `SKIP_PUBLISH`, and unit specs mock the registries.
 * That gap is exactly why cargo auth demanded on a crateless repo shipped despite a green suite.
 * This spec drives the real `runPipeline` with `dryRun: false` so registry auth, discovery, stage
 * ordering, tagging and the GitHub-Release call all run for real.
 *
 * Strategy (per the issue):
 *  - npm  → a local in-process registry (verdaccio-style) so `npm publish` + `npm view` + token auth
 *           run for real without hitting npmjs. The registry MUST be serviced asynchronously: the
 *           pipeline shells out via async `execFile`, so the Node event loop stays free to answer the
 *           subprocess's HTTP requests (a synchronous `execFileSync` would deadlock against it).
 *  - cargo → the `cargo publish` exec is stubbed on PATH; the value under test is auth + discovery +
 *           ordering, not the upload itself.
 *
 * The lightweight guards (enabled-but-empty no-op, missing-credential detection) run by default — they
 * need no network and are the direct regression net. The heavier real-`npm publish` cases
 * are opt-in via `RELEASEKIT_PUBLISH_E2E=1` so the default gate stays fast (see the PR body).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPipeline } from '../../src/pipeline/index.js';
import { getDefaultConfig, type PublishCliOptions, type PublishConfig } from '../../src/types.js';

const E2E_ENABLED = process.env.RELEASEKIT_PUBLISH_E2E === '1' || process.env.RELEASEKIT_PUBLISH_E2E === 'true';

// ---------------------------------------------------------------------------
// In-process npm registry (verdaccio-style, minimal): enough of the registry API for `npm publish`
// and `npm view` — GET returns the packument (404 when unknown), PUT requires a Bearer token and
// stores the published versions so a re-run sees the version as already published.
// ---------------------------------------------------------------------------
interface Packument {
  name: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, unknown>;
}

interface LocalRegistry {
  url: string;
  close: () => Promise<void>;
  putCount: () => number;
  publishedVersions: (name: string) => string[];
}

function startLocalRegistry(): Promise<LocalRegistry> {
  const store = new Map<string, Packument>();
  let puts = 0;

  // Always answer with `Cache-Control: no-store`: Node's http server auto-adds a `Date` header, and
  // without an explicit cache directive npm's fetch layer (make-fetch-happen) applies heuristic
  // freshness and can serve a STALE 404 from the pre-publish `npm view` on the idempotency re-run —
  // which made the already-published skip flaky. `no-store` forces npm to re-query every time.
  const send = (res: http.ServerResponse, status: number, payload: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  };

  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//, ''));

    if (req.method === 'GET') {
      const pkg = store.get(name);
      if (pkg) {
        send(res, 200, pkg);
        return;
      }
      // Version-specific manifest endpoint `GET /<pkg>/<version>` (npm's abbreviated manifest): resolve
      // the trailing path segment as a version from the stored packument, so the registry answers npm
      // clients that query per-version rather than the full packument.
      const lastSlash = name.lastIndexOf('/');
      const versioned =
        lastSlash > 0 ? store.get(name.slice(0, lastSlash))?.versions[name.slice(lastSlash + 1)] : undefined;
      if (versioned) {
        send(res, 200, versioned);
        return;
      }
      send(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method === 'PUT') {
      // Auth is the point: without a Bearer token the publish is rejected, exercising the real
      // npm auth handshake rather than a mock.
      const auth = req.headers.authorization;
      if (!auth || !/^Bearer\s+\S+/.test(auth)) {
        send(res, 401, { error: 'unauthorized: auth token required' });
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let meta: { versions?: Record<string, unknown>; 'dist-tags'?: Record<string, string> } = {};
        try {
          meta = JSON.parse(body);
        } catch {
          // Malformed body still counts as a PUT attempt; fall through with empty metadata.
        }
        const existing = store.get(name) ?? { name, 'dist-tags': {}, versions: {} };
        const incoming = meta.versions ?? {};
        for (const version of Object.keys(incoming)) {
          if (existing.versions[version]) {
            send(res, 403, { error: `cannot publish over the previously published version ${version}` });
            return;
          }
        }
        // Count only a PUT that clears the version-conflict check (i.e. actually stores something), so
        // putCount() unambiguously means "a new publish was accepted", not "a PUT was received".
        puts += 1;
        Object.assign(existing.versions, incoming);
        Object.assign(existing['dist-tags'], meta['dist-tags'] ?? {});
        store.set(name, existing);
        send(res, 201, { ok: true, id: name });
      });
      return;
    }

    send(res, 405, { error: 'method not allowed' });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
        putCount: () => puts,
        publishedVersions: (name) => Object.keys(store.get(name)?.versions ?? {}),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Fixtures + PATH stubs
// ---------------------------------------------------------------------------
const ORIGINAL_CWD = process.cwd();
let stubBinDir: string;
let originalPath: string | undefined;
let savedEnv: NodeJS.ProcessEnv;
const tempDirs: string[] = [];
let activeRegistry: LocalRegistry | undefined;

function mkTemp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rk-e2e-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(file: string, contents: string): void {
  fs.writeFileSync(file, contents, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function writeNpmPackage(dir: string, name: string, version: string): void {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name, version, description: 'releasekit e2e fixture', license: 'MIT', main: 'index.js' }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');
}

function writeCrate(crateDir: string, name: string, version: string): void {
  fs.mkdirSync(path.join(crateDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(crateDir, 'Cargo.toml'),
    `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n`,
  );
  fs.writeFileSync(path.join(crateDir, 'src', 'lib.rs'), '// e2e crate\n');
}

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function initGitRepo(dir: string): void {
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'e2e@releasekit.test'], dir);
  git(['config', 'user.name', 'ReleaseKit E2E'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  git(['add', '-A'], dir);
  git(['commit', '-m', 'chore: initial'], dir);
}

function makeConfig(overrides: (config: PublishConfig) => void): PublishConfig {
  const config = getDefaultConfig();
  config.npm.provenance = false;
  config.npm.copyFiles = [];
  overrides(config);
  return config;
}

function makeCliOptions(overrides: Partial<PublishCliOptions> = {}): PublishCliOptions {
  return {
    registry: 'all',
    npmAuth: 'auto',
    dryRun: false,
    skipGit: false,
    skipPublish: false,
    skipGithubRelease: false,
    skipVerification: false,
    json: false,
    verbose: false,
    ...overrides,
  };
}

beforeAll(() => {
  // Stub `gh` (GitHub Release) and `cargo` (crate publish) on PATH. Both append their argv to the
  // log file named by $GH_STUB_LOG / $CARGO_STUB_LOG so a test can assert they were invoked. `gh
  // release view` exits non-zero so the release-create path is always taken.
  stubBinDir = mkTemp('bin');
  writeExecutable(
    path.join(stubBinDir, 'gh'),
    [
      '#!/usr/bin/env bash',
      'if [ -n "$GH_STUB_LOG" ]; then echo "$*" >> "$GH_STUB_LOG"; fi',
      'if [ "$1" = "release" ] && [ "$2" = "view" ]; then exit 1; fi',
      'if [ "$1" = "release" ] && [ "$2" = "create" ]; then echo "https://example.test/releases/tag/stub"; exit 0; fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  writeExecutable(
    path.join(stubBinDir, 'cargo'),
    ['#!/usr/bin/env bash', 'if [ -n "$CARGO_STUB_LOG" ]; then echo "$*" >> "$CARGO_STUB_LOG"; fi', 'exit 0', ''].join(
      '\n',
    ),
  );
  originalPath = process.env.PATH;
  process.env.PATH = `${stubBinDir}${path.delimiter}${originalPath ?? ''}`;
});

afterAll(() => {
  if (originalPath !== undefined) process.env.PATH = originalPath;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(async () => {
  if (activeRegistry) {
    await activeRegistry.close();
    activeRegistry = undefined;
  }
  process.chdir(ORIGINAL_CWD);
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

// ===========================================================================
// Lightweight guards — run in the default gate (no network, no real publish).
// ===========================================================================
describe('Publish pipeline e2e (non-dry-run guards)', () => {
  it('should no-op enabled-but-empty cargo and pub stages without demanding credentials', async () => {
    // The regression class: cargo/pub enabled on a repo with no crates/pub packages must not
    // fail on a missing registry token. A dry run can't catch this (auth is dry-run-exempt); this is
    // a REAL non-dry-run run with no CARGO_REGISTRY_TOKEN / PUB_TOKEN present.
    delete process.env.CARGO_REGISTRY_TOKEN;
    delete process.env.PUB_TOKEN;

    const dir = mkTemp('empty');
    writeNpmPackage(dir, 'releasekit-e2e-empty', '1.1.0');
    process.chdir(dir);

    const config = makeConfig((c) => {
      c.npm.enabled = false; // isolate the cargo/pub no-op from any npm publish
      c.cargo.enabled = true;
      c.pub.enabled = true;
    });
    const input = {
      dryRun: false,
      updates: [{ packageName: 'releasekit-e2e-empty', newVersion: '1.1.0', filePath: 'package.json' }],
      changelogs: [],
      tags: [],
    };
    const options = makeCliOptions({ skipGit: true, skipGithubRelease: true, skipVerification: true });

    const output = await runPipeline(input, config, options);

    expect(output.cargo).toHaveLength(0);
    expect(output.pub).toHaveLength(0);
    expect(output.publishSucceeded).toBe(true);
  });

  it('should fail with an auth error when a non-dry-run npm publish has targets but no credentials', async () => {
    // Per-registry auth DETECTION (absence): npm enabled, a target present, auth 'auto' resolving to
    // no method must abort before any publish. Deleting the token/OIDC env keeps detection deterministic.
    delete process.env.NPM_TOKEN;
    delete process.env.NODE_AUTH_TOKEN;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;

    const dir = mkTemp('npm-noauth');
    writeNpmPackage(dir, 'releasekit-e2e-noauth', '1.0.0');
    process.chdir(dir);

    const config = makeConfig((c) => {
      c.npm.auth = 'auto';
    });
    const input = {
      dryRun: false,
      updates: [{ packageName: 'releasekit-e2e-noauth', newVersion: '1.0.0', filePath: 'package.json' }],
      changelogs: [],
      tags: [],
    };
    const options = makeCliOptions({ skipGit: true, skipGithubRelease: true, skipVerification: true });

    await expect(runPipeline(input, config, options)).rejects.toMatchObject({
      failedStage: 'npm-publish',
      message: expect.stringMatching(/authentication/i),
    });
  });

  it('should demand a cargo token only when crates are actually present (the inverse)', async () => {
    // The complement of the no-op guard: with a crate discovered, a non-dry-run run WITH no token must
    // fail fast at auth — proving the discover-then-auth ordering demands credentials exactly when used.
    delete process.env.CARGO_REGISTRY_TOKEN;

    const dir = mkTemp('cargo-noauth');
    writeCrate(path.join(dir, 'crate'), 'releasekit-e2e-crate-noauth', '0.1.0');
    process.chdir(dir);

    const config = makeConfig((c) => {
      c.npm.enabled = false;
      c.cargo.enabled = true;
    });
    const input = {
      dryRun: false,
      updates: [{ packageName: 'releasekit-e2e-crate-noauth', newVersion: '0.1.0', filePath: 'crate/Cargo.toml' }],
      changelogs: [],
      tags: [],
    };
    const options = makeCliOptions({ skipGit: true, skipGithubRelease: true, skipVerification: true });

    await expect(runPipeline(input, config, options)).rejects.toMatchObject({
      failedStage: 'cargo-publish',
      message: expect.stringMatching(/CARGO_REGISTRY_TOKEN/),
    });
  });
});

// ===========================================================================
// Heavy path — real `npm publish` against the in-process registry. Opt-in.
// ===========================================================================
describe.skipIf(!E2E_ENABLED)('Publish pipeline e2e (real npm registry)', () => {
  function useTokenAuth(): void {
    // pnpm (the CI invocation is `pnpm --filter @releasekit/publish test`, not bare vitest) injects
    // `npm_config_*` into the environment — including an `npm_config_registry` that, being env-level,
    // OVERRIDES the pipeline's per-run userconfig and makes `npm publish` target registry.npmjs.org
    // (→ ENEEDAUTH). Strip every `npm_config_*` key so the pipeline's isolated userconfig (local
    // registry + token) wins, and pin globalconfig / cache / HOME to throwaway paths so no ambient
    // `~/.npmrc` leaks in either. The full-env restore in afterEach undoes all of this.
    for (const key of Object.keys(process.env)) {
      if (/^npm_config_/i.test(key)) delete process.env[key];
    }
    const home = mkTemp('npm-home');
    const emptyGlobalNpmrc = path.join(home, 'global-npmrc');
    fs.writeFileSync(emptyGlobalNpmrc, '');
    process.env.HOME = home;
    process.env.npm_config_globalconfig = emptyGlobalNpmrc;
    process.env.npm_config_cache = path.join(home, '.npm-cache');

    delete process.env.NPM_TOKEN;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    process.env.NODE_AUTH_TOKEN = 'releasekit-e2e-token';
  }

  it('should publish to the registry with token auth, then create and push the tag and GitHub release', async () => {
    // The full non-dry-run pipeline in ORDER: prepare → commit+tag → npm publish (token auth, real
    // client) → push branch+tags to a local bare remote → `gh release create`. Covers scenario (3)
    // auth-present detection and scenario (4) post-publish tag + GitHub-Release creation.
    useTokenAuth();
    const registry = await startLocalRegistry();
    activeRegistry = registry;

    const dir = mkTemp('npm-full');
    const name = `releasekit-e2e-full-${Date.now()}`;
    writeNpmPackage(dir, name, '1.0.0');
    initGitRepo(dir);
    const bare = mkTemp('remote');
    git(['init', '--bare', bare], ORIGINAL_CWD);
    git(['remote', 'add', 'origin', bare], dir);

    // Bump on disk (uncommitted) so the commit stage has a real change to record — as the version
    // step would leave it before publish runs.
    writeNpmPackage(dir, name, '1.0.1');
    const ghLog = path.join(mkTemp('ghlog'), 'gh.log');
    process.env.GH_STUB_LOG = ghLog;

    const config = makeConfig((c) => {
      c.npm.registry = registry.url;
      c.npm.auth = 'token';
      c.git.branch = 'main';
    });
    const input = {
      dryRun: false,
      updates: [{ packageName: name, newVersion: '1.0.1', filePath: 'package.json' }],
      changelogs: [],
      commitMessage: 'chore: release v1.0.1',
      tags: ['v1.0.1'],
    };
    const options = makeCliOptions({ npmAuth: 'token', skipVerification: true });

    process.chdir(dir);
    const output = await runPipeline(input, config, options);

    // npm published for real, exactly once.
    expect(output.npm).toHaveLength(1);
    expect(output.npm[0]).toMatchObject({ success: true, skipped: false });
    expect(registry.putCount()).toBe(1);
    expect(registry.publishedVersions(name)).toContain('1.0.1');

    // Tag committed + pushed to the remote.
    expect(output.git.committed).toBe(true);
    expect(output.git.pushed).toBe(true);
    expect(output.git.tags).toContain('v1.0.1');
    const remoteTags = execFileSync('git', ['-C', bare, 'tag', '--list'], { encoding: 'utf-8' });
    expect(remoteTags).toContain('v1.0.1');

    // GitHub release created (via the stubbed gh) after the push.
    expect(output.githubReleases).toHaveLength(1);
    expect(output.githubReleases[0]).toMatchObject({ tag: 'v1.0.1', success: true });
    const ghCalls = fs.readFileSync(ghLog, 'utf-8');
    expect(ghCalls).toMatch(/release create v1\.0\.1/);
    expect(output.publishSucceeded).toBe(true);
  });

  it('should skip an already-published version on a re-run without re-publishing (idempotency)', async () => {
    // A partial-failure re-run must be safe: the second pipeline sees the version already on the
    // registry (via `npm view`) and skips it — no second PUT, no failure.
    useTokenAuth();
    const registry = await startLocalRegistry();
    activeRegistry = registry;

    const dir = mkTemp('npm-idem');
    const name = `releasekit-e2e-idem-${Date.now()}`;
    writeNpmPackage(dir, name, '1.0.0');
    process.chdir(dir);

    const config = makeConfig((c) => {
      c.npm.registry = registry.url;
      c.npm.auth = 'token';
    });
    const input = {
      dryRun: false,
      updates: [{ packageName: name, newVersion: '1.0.0', filePath: 'package.json' }],
      changelogs: [],
      tags: [],
    };
    const options = makeCliOptions({
      npmAuth: 'token',
      skipGit: true,
      skipGithubRelease: true,
      skipVerification: true,
    });

    const first = await runPipeline(input, config, options);
    expect(first.npm[0]).toMatchObject({ success: true, skipped: false });
    expect(registry.putCount()).toBe(1);

    const second = await runPipeline(input, config, options);
    expect(second.npm[0]).toMatchObject({ success: true, skipped: true, alreadyPublished: true });
    expect(registry.putCount()).toBe(1); // no second publish
    expect(second.publishSucceeded).toBe(true);
  });

  it('should run the stubbed cargo publish once auth is present (auth + ordering, upload stubbed)', async () => {
    // Cargo's upload is stubbed (PATH). With a token present, auth passes and the pipeline proceeds
    // through discovery → already-published check → the stubbed `cargo publish`. Exercises the
    // "stub the exec, keep the auth/ordering real" half of the issue. A unique crate name keeps the
    // crates.io already-published check a fast 404 (and it is catch-safe if the network is down).
    process.env.CARGO_REGISTRY_TOKEN = 'releasekit-e2e-cargo-token';
    const cargoLog = path.join(mkTemp('cargolog'), 'cargo.log');
    process.env.CARGO_STUB_LOG = cargoLog;

    const dir = mkTemp('cargo-pub');
    const crateName = `releasekit-e2e-crate-${Date.now()}`;
    writeCrate(path.join(dir, 'crate'), crateName, '0.1.0');
    process.chdir(dir);

    const config = makeConfig((c) => {
      c.npm.enabled = false;
      c.cargo.enabled = true;
    });
    const input = {
      dryRun: false,
      updates: [{ packageName: crateName, newVersion: '0.1.0', filePath: 'crate/Cargo.toml' }],
      changelogs: [],
      tags: [],
    };
    const options = makeCliOptions({
      registry: 'cargo',
      skipGit: true,
      skipGithubRelease: true,
      skipVerification: true,
    });

    const output = await runPipeline(input, config, options);

    expect(output.cargo).toHaveLength(1);
    expect(output.cargo[0]).toMatchObject({ packageName: crateName, success: true, skipped: false });
    expect(fs.readFileSync(cargoLog, 'utf-8')).toMatch(/^publish /m);
  }, 35_000);
});
