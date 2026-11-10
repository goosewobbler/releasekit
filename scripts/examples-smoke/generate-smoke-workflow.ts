#!/usr/bin/env tsx
/**
 * Generated rather than hand-written so the smoke job runs the setup steps the
 * examples actually ship; a hand-written mirror would rot. `--check` (run in CI)
 * fails on drift.
 *
 * Runs on a real hosted runner rather than under `act`, whose Docker image
 * pre-installs pnpm/cargo and so would hide a missing pnpm/action-setup.
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

function isCheckout(step: Step): boolean {
  return typeof step.uses === 'string' && step.uses.startsWith('actions/checkout');
}

/** An invocation, not a mention: the standing-pr banner step's `releasekit-processing` marker must not end extraction. */
function isReleasekitRun(step: Step): boolean {
  return typeof step.run === 'string' && /\breleasekit(?:\s|$)/m.test(step.run);
}

/** `gh api` steps (e.g. the standing-pr retry label removal) need real secrets and a real repo. */
function isOutOfScopeApiStep(step: Step): boolean {
  return typeof step.run === 'string' && /\bgh\s+api\b/.test(step.run);
}

function isSecretReferencingEnvValue(value: unknown): boolean {
  return typeof value === 'string' && /\$\{\{\s*secrets\./.test(value);
}

function extractSetupSteps(scenario: Scenario): Step[] {
  const file = join(rootDir, 'examples', 'ci', scenario.id, scenario.workflow);
  const doc = parseYaml(readFileSync(file, 'utf8')) as { jobs?: Record<string, { steps?: Step[] }> };
  const job = doc.jobs?.[scenario.job];
  if (!job?.steps) {
    throw new Error(`Job "${scenario.job}" not found in ${file}`);
  }
  const setup: Step[] = [];
  for (const step of job.steps) {
    if (isReleasekitRun(step)) {
      break;
    }
    if (isCheckout(step) || isOutOfScopeApiStep(step)) {
      continue;
    }
    // Strip only `secrets.*` references, which would fail or do harm in a dry
    // run; diagnostic toggles (LOG_LEVEL, RUST_BACKTRACE, ...) and literals stay.
    const cleaned: Step = { ...step };
    if (cleaned.env && typeof cleaned.env === 'object') {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cleaned.env as Record<string, unknown>)) {
        if (!isSecretReferencingEnvValue(v)) {
          filtered[k] = v;
        }
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
 * The dry run short-circuits the real `cargo publish`, so a missing
 * rust-toolchain would slip through on dry-run alone.
 */
function runtimeProbe(scenario: Scenario): Step | undefined {
  const cfg = JSON.parse(readFileSync(join(rootDir, 'examples', 'ci', scenario.id, scenario.config), 'utf8')) as {
    version?: { cargo?: { enabled?: boolean } };
    publish?: { cargo?: { enabled?: boolean } };
  };
  const cargoEnabled = cfg.version?.cargo?.enabled === true || cfg.publish?.cargo?.enabled === true;
  if (!cargoEnabled) {
    return undefined;
  }
  return {
    name: 'Probe: cargo is on PATH (config enables cargo)',
    run: 'cargo --version',
  };
}

function smokeJob(scenario: Scenario): Record<string, unknown> {
  const steps: Step[] = [
    {
      // No actions/checkout: the workspace starts EMPTY so the example's own
      // setup is the only thing that can put pnpm/cargo on PATH.
      name: 'Download fixture bundle',
      uses: 'actions/download-artifact@v8',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: ${{ runner.temp }} is a GitHub Actions expression, not a JS template placeholder
      with: { name: `smoke-fixture-${scenario.id}`, path: '${{ runner.temp }}/fixture' },
    },
    {
      // Into the workspace root, where setup-node's `cache: pnpm` expects the lockfile.
      name: 'Restore fixture into workspace',
      run: `git clone --quiet "$RUNNER_TEMP/fixture/${scenario.id}.bundle" .`,
    },
  ];

  for (const step of extractSetupSteps(scenario)) {
    steps.push(step);
  }

  const probe = runtimeProbe(scenario);
  if (probe) {
    steps.push(probe);
  }

  steps.push({
    name: `Dry-run ${scenario.releaseArgs[0]} (${scenario.proves})`,
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
          // For the releasekit build only; the smoke jobs start without pnpm.
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

  // Release code & its deps too, or a regression there could break the smoke without re-triggering it.
  const triggerPaths = [
    'examples/**',
    'scripts/examples-smoke/**',
    '.github/workflows/examples-smoke.yml',
    'packages/**',
    'package.json',
    'pnpm-lock.yaml',
  ];

  return {
    name: 'Examples Smoke',
    on: {
      push: {
        branches: ['main'],
        paths: [...triggerPaths],
      },
      pull_request: {
        branches: ['main'],
        paths: [...triggerPaths],
      },
      // Nightly backstop for regressions the path filters miss (transitive dep bumps, runner-image drift).
      schedule: [{ cron: '0 3 * * *' }],
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
