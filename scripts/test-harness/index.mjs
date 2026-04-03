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
 *
 * The harness defaults to running in "CI simulation" mode where:
 * - Only the test project's node_modules are available in NODE_PATH
 * - This mimics the actual CI environment where the action's node_modules aren't available
 */
import { getRemoteRefs, verifyTags, verifyVersionCommit } from './mock-git.mjs';
import { parseInputs, runActionLocal } from './run-action-local.mjs';
import { cleanupTestProject, createTestProject } from './test-project.mjs';

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
    console.error(`\n❌ ${mode} failed with exit code ${result.status}`);
    process.exit(1);
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
} finally {
  if (projectDir && options.cleanup !== 'false') {
    console.log(`\n--- Cleanup ---`);
    cleanupTestProject(projectDir);
  }
}
