#!/usr/bin/env tsx
/**
 * Generates .github/workflows/examples-smoke.yml from the SHIPPED example
 * workflows (issue #276).
 *
 * Why generated instead of hand-written: the smoke test must run the same setup
 * steps the example ships, or it proves nothing — and a hand-written mirror rots
 * out of sync. This generator EXTRACTS each example job's setup steps straight
 * from the example YAML, so the smoke job runs the real steps. Drift is caught
 * by `--check` (run in CI): regenerate, diff, fail on any change.
 *
 * Approach (chosen over `act`): extract + run on a REAL hosted runner. `act`
 * runs in a Docker image that pre-installs pnpm/cargo, so a missing
 * pnpm/action-setup would NOT fail under it — defeating the whole exercise. A
 * real ubuntu-latest ships neither, so the missing-tool class surfaces faithfully.
 *
 * Usage:
 *   tsx scripts/examples-smoke/generate-smoke-workflow.ts           # write
 *   tsx scripts/examples-smoke/generate-smoke-workflow.ts --check   # verify no drift
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { SCENARIOS, type Scenario } from './scenarios.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = normalize(join(__dirname, '..', '..'));
const OUTPUT = join(rootDir, '.github', 'workflows', 'examples-smoke.yml');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  [k: string]: unknown;
}

/** True for the example's own checkout — dropped; the smoke job lays down a fixture instead. */
function isCheckout(step: Step): boolean {
  return typeof step.uses === 'string' && step.uses.startsWith('actions/checkout');
}

/** True for the terminal step that actually invokes releasekit — dropped and replaced with a dry run. */
function isReleasekitRun(step: Step): boolean {
  return typeof step.run === 'string' && /\breleasekit\b/.test(step.run);
}

/**
 * True for steps that need real secrets / a real repo and are out of scope (the
 * residual gap): the standing-pr retry label-removal `gh api` step. Identified
 * structurally (a `gh api` run), not by hand-listing, so it can't silently drift.
 */
function isOutOfScopeApiStep(step: Step): boolean {
  return typeof step.run === 'string' && /\bgh\s+api\b/.test(step.run);
}

/**
 * An env value that's safe to replay in a dry-run smoke job. A reference to
 * `secrets.*` (e.g. `NPM_TOKEN`, `GITHUB_TOKEN`) is a real auth credential that
 * the smoke job has no need of; GHA expressions and literals are fine.
 */
function isSecretReferencingEnvValue(value: unknown): boolean {
  return typeof value === 'string' && /\$\{\{\s*secrets\./.test(value);
}

/** Extract the setup steps to replay: everything up to (and excluding) the releasekit invocation. */
function extractSetupSteps(scenario: Scenario): Step[] {
  const file = join(rootDir, 'examples', 'ci', scenario.id, scenario.workflow);
  const doc = parseYaml(readFileSync(file, 'utf8')) as { jobs?: Record<string, { steps?: Step[] }> };
  const job = doc.jobs?.[scenario.job];
  if (!job?.steps) {
    throw new Error(`Job "${scenario.job}" not found in ${file}`);
  }
  const setup: Step[] = [];
  for (const step of job.steps) {
    if (isReleasekitRun(step)) break; // setup is everything before the release call
    if (isCheckout(step) || isOutOfScopeApiStep(step)) continue;
    // Strip only envs that would fail or do harm in a dry run: references to
    // `secrets.*`. Keep diagnostic toggles (LOG_LEVEL, RUST_BACKTRACE, ...) and
    // plain literals — the smoke job's value is the missing-tool signal, not
    // the secret-bearing env.
    const cleaned: Step = { ...step };
    if (cleaned.env && typeof cleaned.env === 'object') {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cleaned.env as Record<string, unknown>)) {
        if (!isSecretReferencingEnvValue(v)) filtered[k] = v;
      }
      if (Object.keys(filtered).length > 0) {
        cleaned.env = filtered;
      } else {
        delete cleaned.env;
      }
    }
    setup.push(cleaned);
  }
  if (setup.length === 0) {
    throw new Error(`No setup steps extracted for scenario "${scenario.id}" — check workflow/job names`);
  }
  return setup;
}

/**
 * Config-derived runtime probe. The dry run short-circuits the real `cargo
 * publish`, so a missing rust-toolchain would slip through on dry-run alone.
 * When the shipped config enables cargo we assert `cargo` is actually on PATH —
 * derived from the config, so it can't drift from the example.
 */
function runtimeProbe(scenario: Scenario): Step | undefined {
  const cfg = JSON.parse(readFileSync(join(rootDir, 'examples', 'ci', scenario.id, scenario.config), 'utf8')) as {
    version?: { cargo?: { enabled?: boolean } };
    publish?: { cargo?: { enabled?: boolean } };
  };
  const cargoEnabled = cfg.version?.cargo?.enabled === true || cfg.publish?.cargo?.enabled === true;
  if (!cargoEnabled) return undefined;
  return {
    name: 'Probe: cargo is on PATH (config enables cargo)',
    // The example's rust-toolchain step must have put cargo here; if it was
    // dropped, this fails with the very `cargo: command not found` we guard against.
    run: 'cargo --version',
  };
}

function smokeJob(scenario: Scenario): Record<string, unknown> {
  const steps: Step[] = [
    {
      // No actions/checkout: the workspace starts EMPTY so the example's own
      // setup is the only thing that can put pnpm/cargo on PATH. The fixture
      // arrives as a git bundle, downloaded outside the workspace.
      name: 'Download fixture bundle',
      uses: 'actions/download-artifact@v8',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: ${{ runner.temp }} is a GitHub Actions expression, not a JS template placeholder
      with: { name: `smoke-fixture-${scenario.id}`, path: '${{ runner.temp }}/fixture' },
    },
    {
      // Clone the bundle into the (empty) workspace root so the lockfile sits at
      // the root where setup-node's `cache: pnpm` expects it, and the dry run
      // sees the conventional commits + baseline tag.
      name: 'Restore fixture into workspace',
      run: `git clone --quiet "$RUNNER_TEMP/fixture/${scenario.id}.bundle" .`,
    },
  ];

  // The real, extracted example setup — verbatim, never hand-copied.
  for (const step of extractSetupSteps(scenario)) {
    steps.push(step);
  }

  const probe = runtimeProbe(scenario);
  if (probe) steps.push(probe);

  steps.push({
    name: `Dry-run release (${scenario.proves})`,
    run: `pnpm exec releasekit ${scenario.releaseArgs.join(' ')}`,
  });

  return {
    name: `smoke (${scenario.id})`,
    'runs-on': 'ubuntu-latest',
    needs: 'prepare',
    steps,
  };
}

export function buildWorkflow(): Record<string, unknown> {
  const jobs: Record<string, unknown> = {
    prepare: {
      name: 'Prepare fixtures',
      'runs-on': 'ubuntu-latest',
      steps: [
        { name: 'Checkout', uses: 'actions/checkout@v7' },
        {
          // Sets up pnpm/Node FOR THE RELEASEKIT BUILD only. This toolchain lives
          // in the prepare job; the smoke jobs are separate and start with pnpm
          // ABSENT, so a missing pnpm/action-setup in an example genuinely fails there.
          name: 'Setup workspace',
          uses: './.github/workflows/actions/setup-workspace',
        },
        { name: 'Build releasekit', run: 'pnpm build' },
        {
          name: 'Pack releasekit tarballs',
          run: [
            'mkdir -p .smoke-tarballs',
            'for pkg in core config version notes publish release; do',
            '  ( cd "packages/$pkg" && pnpm pack --pack-destination "$GITHUB_WORKSPACE/.smoke-tarballs" )',
            'done',
          ].join('\n'),
        },
        {
          name: 'Build fixtures + bundle git history',
          run: [
            'mkdir -p .smoke-bundles',
            `for s in ${SCENARIOS.map((s) => s.id).join(' ')}; do`,
            '  out=".smoke-fixtures/$s"',
            '  pnpm tsx scripts/examples-smoke/build-fixture.ts \\',
            '    --scenario "$s" --out "$out" --tarball-dir .smoke-tarballs --seed-lockfile',
            '  # Ship the whole fixture (files + committed tarballs + lockfile) as a',
            '  # single bundle so the smoke job restores it with `git clone`.',
            '  git -C "$out" bundle create "$GITHUB_WORKSPACE/.smoke-bundles/$s.bundle" --all',
            'done',
          ].join('\n'),
        },
        ...SCENARIOS.map((s) => ({
          name: `Upload fixture bundle (${s.id})`,
          uses: 'actions/upload-artifact@v7',
          with: { name: `smoke-fixture-${s.id}`, path: `.smoke-bundles/${s.id}.bundle`, 'if-no-files-found': 'error' },
        })),
      ],
    },
  };

  for (const scenario of SCENARIOS) {
    jobs[`smoke-${scenario.id}`] = smokeJob(scenario);
  }

  return {
    name: 'Examples Smoke',
    on: {
      push: {
        branches: ['main'],
        paths: ['examples/**', 'scripts/examples-smoke/**', '.github/workflows/examples-smoke.yml'],
      },
      pull_request: {
        branches: ['main'],
        paths: ['examples/**', 'scripts/examples-smoke/**', '.github/workflows/examples-smoke.yml'],
      },
      workflow_dispatch: {},
    },
    permissions: { contents: 'read' },
    jobs,
  };
}

const HEADER = `# GENERATED FILE — do not edit by hand.
#
# Execution smoke-test for the runnable CI examples (issue #276). Where
# examples-validate.yml lints the examples statically, this workflow RUNS each
# example's real setup steps on a hosted runner and then a releasekit --dry-run,
# catching the missing-runtime-tool class (pnpm/cargo: command not found) that a
# static linter cannot see.
#
# The per-scenario setup steps are EXTRACTED from the shipped example workflows,
# never hand-copied, so they cannot drift. Regenerate after changing an example:
#   pnpm examples:smoke:generate
# CI verifies there is no drift via:
#   pnpm examples:smoke:check
#
# Source: scripts/examples-smoke/{scenarios.ts,generate-smoke-workflow.ts}.
`;

export function render(): string {
  const body = stringifyYaml(buildWorkflow(), { lineWidth: 0 });
  return `${HEADER}${body}`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const generated = render();
  if (check) {
    let current = '';
    try {
      current = readFileSync(OUTPUT, 'utf8');
    } catch {
      current = '';
    }
    if (current !== generated) {
      console.error(
        `examples-smoke.yml is out of date with the example workflows.\n` +
          `Run \`pnpm examples:smoke:generate\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log('examples-smoke.yml is up to date.');
    return;
  }
  writeFileSync(OUTPUT, generated);
  console.log(`Wrote ${OUTPUT}`);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
