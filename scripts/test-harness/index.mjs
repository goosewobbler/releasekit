/**
 * Action Test Harness
 *
 * Simulates the GitHub Action environment to test the releasekit CLI locally.
 * This harness:
 * - Creates an isolated test project in a temp directory
 * - Simulates the CI environment (NODE_PATH only includes user's project node_modules)
 * - Runs the action's CLI with environment variables passed as INPUT_* vars
 * - Verifies the output matches expected behavior
 *
 * Usage:
 *   pnpm test:harness           # Run preview mode (default)
 *   pnpm test:harness:preview   # Run preview mode explicitly
 *   pnpm test:harness:release   # Run release mode with patch bump
 *   pnpm test:harness:multi     # Run release mode with npm + cargo, verify both manifests bumped
 *   pnpm test:harness:backfill  # Reconstruct notes from git history (--all + --package), verify files/dates/scoping
 *
 * The harness defaults to running in "CI simulation" mode where:
 * - Only the test project's node_modules are available in NODE_PATH
 * - This mimics the actual CI environment where the action's node_modules aren't available
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRemoteRefs, verifyTags, verifyVersionCommit } from './mock-git.mjs';
import { parseInputs, runActionLocal } from './run-action-local.mjs';
import {
  cleanupTestProject,
  createBackfillTestProject,
  createMultiRegistryTestProject,
  createTestProject,
} from './test-project.mjs';

const args = process.argv.slice(2);
const mode = args[0] || 'preview';
const options = {};

for (let i = 1; i < args.length; i += 2) {
  if (args[i].startsWith('--')) {
    options[args[i].slice(2)] = args[i + 1];
  }
}

console.log(`\n=== ReleaseKit Test Harness (CI Simulation) ===`);
console.log(`Mode: ${mode}`);
console.log(`Options:`, options);
console.log('');

let projectDir;
try {
  if (mode === 'release-multi') {
    const testProject = createMultiRegistryTestProject();
    projectDir = testProject.projectDir;

    console.log(`\n--- Running release-multi mode ---`);

    const envVars = {
      INPUT_MODE: 'release',
      INPUT_PROJECT_DIR: testProject.projectDir,
      INPUT_CONFIG: 'releasekit.config.json',
      INPUT_SKIP_PUBLISH: 'true',
      INPUT_SKIP_GITHUB_RELEASE: 'true',
      INPUT_SKIP_VERIFICATION: 'true',
      INPUT_SKIP_GIT: 'true',
      INPUT_VERBOSE: 'true',
      INPUT_BUMP: 'patch',
    };

    const result = runActionLocal(envVars);

    console.log('\n--- Action Output ---');
    console.log('Exit code:', result.status);
    if (result.stdout) {
      console.log('\nSTDOUT:');
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.log('\nSTDERR:');
      console.log(result.stderr);
    }

    if (result.status !== 0) {
      throw new Error(`release-multi failed with exit code ${result.status}`);
    }

    console.log('\n--- Verifying Multi-Registry Version Bumps ---');
    const expectedVersion = '1.0.1';
    for (const pkgSlug of testProject.packages) {
      const pkgDir = path.join(testProject.projectDir, 'packages', pkgSlug);

      const pkgJsonPath = path.join(pkgDir, 'package.json');
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      if (pkgJson.version !== expectedVersion) {
        throw new Error(`${pkgSlug} package.json: expected ${expectedVersion}, got ${pkgJson.version}`);
      }

      const cargoTomlPath = path.join(pkgDir, 'Cargo.toml');
      const cargoContent = fs.readFileSync(cargoTomlPath, 'utf-8');
      const cargoVersionMatch = cargoContent.match(/^version = "([^"]+)"/m);
      const cargoVersion = cargoVersionMatch?.[1];
      if (cargoVersion !== expectedVersion) {
        throw new Error(`${pkgSlug} Cargo.toml: expected ${expectedVersion}, got ${cargoVersion}`);
      }

      console.log(`✓ ${pkgSlug}: package.json=${pkgJson.version}, Cargo.toml=${cargoVersion}`);
    }

    console.log(`\n✅ release-multi completed successfully`);
  } else if (mode === 'backfill') {
    const testProject = createBackfillTestProject();
    projectDir = testProject.projectDir;

    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const cliPath = path.resolve(scriptDir, '..', '..', 'packages', 'release', 'dist', 'cli.js');
    if (!fs.existsSync(cliPath)) {
      throw new Error(`CLI not found at: ${cliPath}. Run "pnpm build" first.`);
    }

    const runBackfill = (extraArgs) => {
      console.log(`\n--- Running: backfill ${extraArgs.join(' ')} ---`);
      const result = spawnSync('node', [cliPath, 'backfill', ...extraArgs], {
        cwd: projectDir,
        encoding: 'utf-8',
        env: process.env,
      });
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.log(result.stderr);
      return result;
    };

    const assert = (cond, msg) => {
      if (!cond) throw new Error(`Backfill assertion failed: ${msg}`);
    };

    // 1. --all --apply: reconstruct every workspace package from the global tag series, write files.
    const applyResult = runBackfill(['--all', '--apply', '-c', 'releasekit.config.json']);
    if (applyResult.status !== 0) {
      throw new Error(`backfill --all failed with exit code ${applyResult.status}`);
    }

    console.log('\n--- Verifying backfilled release-notes files ---');
    const notesDir = path.join(projectDir, 'release-notes');
    const today = new Date().toISOString().slice(0, 10);
    for (const exp of testProject.expected) {
      const filePath = path.join(notesDir, exp.file);
      assert(fs.existsSync(filePath), `expected file ${exp.file} to exist`);
      const body = fs.readFileSync(filePath, 'utf-8');
      // Date comes from the tag's commit, not the day the backfill ran.
      assert(body.includes(exp.date), `${exp.file} should be dated ${exp.date}`);
      assert(!body.includes(today), `${exp.file} should not be stamped with today's date (${today})`);
      // Entries are scoped to the package's own directory.
      for (const s of exp.has) assert(body.includes(s), `${exp.file} should mention "${s}"`);
      for (const s of exp.hasNot) assert(!body.includes(s), `${exp.file} should NOT mention "${s}" (path scoping)`);
      console.log(`✓ ${exp.file}: dated ${exp.date}, scoped correctly`);
    }

    // 2. --package + --path + --from: single package, version-bounded (dry-run). Logs go to stderr.
    const dryResult = runBackfill([
      '--package',
      '@test/alpha',
      '--path',
      'packages/alpha',
      '--from',
      '1.1.0',
      '-c',
      'releasekit.config.json',
    ]);
    if (dryResult.status !== 0) {
      throw new Error(`backfill --package failed with exit code ${dryResult.status}`);
    }
    const dryOut = `${dryResult.stdout ?? ''}${dryResult.stderr ?? ''}`;
    assert(dryOut.includes('@test/alpha'), '--package run should name the package');
    // --from 1.1.0 drops 1.0.0, leaving exactly one version.
    assert(dryOut.includes('Would backfill 1 version(s)'), '--from 1.1.0 should leave exactly one version');
    assert(dryOut.includes('1.1.0'), 'the remaining version should be 1.1.0');
    // --path scopes the preview to this package only.
    assert(dryOut.includes('alpha two'), "preview should include this package's commit");
    assert(!dryOut.includes('beta two'), 'preview should be scoped to packages/alpha (no beta commits)');
    console.log('✓ --package @test/alpha --path packages/alpha --from 1.1.0: single package, scoped, version-bounded');

    console.log(`\n✅ backfill completed successfully`);
  } else {
    const testProject = createTestProject();
    projectDir = testProject.projectDir;

    console.log(`\n--- Running ${mode} mode with INPUT_* env vars ---`);

    const envVars = {
      INPUT_MODE: mode,
      INPUT_PROJECT_DIR: testProject.projectDir,
      INPUT_CONFIG: 'releasekit.config.json',
      INPUT_DRY_RUN: 'true',
      INPUT_SKIP_PUBLISH: 'true',
      INPUT_SKIP_GITHUB_RELEASE: 'true',
      INPUT_SKIP_VERIFICATION: 'true',
      INPUT_SKIP_GIT: 'true',
    };

    if (mode === 'release') {
      envVars.INPUT_VERBOSE = 'true';
      envVars.INPUT_JSON = 'true';
      if (options.bump) {
        envVars.INPUT_BUMP = options.bump;
      }
    }

    if (mode === 'preview') {
      envVars.INPUT_PREVIEW_DRY_RUN = 'true';
    }

    const parsed = parseInputs(envVars);
    console.log(`Parsed mode from INPUT_MODE: ${parsed.mode}`);

    if (parsed.mode !== mode) {
      throw new Error(`Expected mode "${mode}" but parsed as "${parsed.mode}"`);
    }
    console.log('✓ INPUT_MODE correctly parsed from env vars');

    const result = runActionLocal(envVars);

    console.log('\n--- Action Output ---');
    console.log('Exit code:', result.status);
    if (result.stdout) {
      console.log('\nSTDOUT:');
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.log('\nSTDERR:');
      console.log(result.stderr);
    }

    if (result.status !== 0) {
      throw new Error(`${mode} failed with exit code ${result.status}`);
    }

    if (mode === 'release') {
      console.log('\n--- Verifying Release ---');

      try {
        verifyVersionCommit(projectDir);
        console.log('✓ Version commit exists');
      } catch (_e) {
        console.warn('⚠ Version commit not found (expected for dry-run without --skip-git)');
      }

      const expectedTags = ['pkg-a@1.0.1', 'pkg-b@1.0.1', 'pkg-c@1.0.1'];
      try {
        verifyTags(projectDir, expectedTags);
        console.log('✓ Tags exist:', expectedTags.join(', '));
      } catch (_e) {
        console.warn('⚠ Tags not found (expected for dry-run without --skip-git)');
      }

      const remoteRefs = getRemoteRefs(testProject.remotePath);
      console.log('Remote refs (should be empty - no actual push):');
      console.log(`  Branches: ${remoteRefs.branches || '(none)'}`);
      console.log(`  Tags: ${remoteRefs.tags || '(none)'}`);
    }

    if (mode === 'preview') {
      console.log('\n--- Verifying Preview ---');
      if (result.stdout?.includes('releasekit-preview')) {
        console.log('✓ Preview markdown generated');
        console.log('\nPreview content (first 500 chars):');
        console.log(result.stdout.substring(0, 500));
      } else {
        console.warn('⚠ No preview markdown found in output');
      }

      if (result.stdout?.includes('No release label detected')) {
        console.log('✓ No release label detected message present');
      }
    }

    console.log(`\n✅ ${mode} completed successfully`);
  }
} finally {
  if (projectDir && options.cleanup !== 'false') {
    console.log(`\n--- Cleanup ---`);
    cleanupTestProject(projectDir);
  }
}
