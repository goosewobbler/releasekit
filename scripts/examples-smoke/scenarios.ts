/**
 * Scenario manifest for the examples execution smoke-test (issue #276).
 *
 * This is deliberately METADATA, not a mirror of the example workflows' steps.
 * It names, per scenario:
 *   - which example workflow file + job's setup steps to EXTRACT (so the smoke
 *     test runs the real shipped steps and cannot drift — a future change to the
 *     example flows straight through the generator);
 *   - which shipped releasekit.config.json the throwaway fixture uses;
 *   - the fixture shape (npm-only or npm+cargo) the example assumes;
 *   - the releasekit invocation to probe the environment with (always --dry-run,
 *     so publish / the OIDC exchange never fire — see the README residual-gap note).
 *
 * The setup steps themselves are never written here; they are read out of the
 * example YAML at generation time. Drift is impossible to merge because CI runs
 * the generator with --check and fails on any diff.
 */

export interface Scenario {
  /** Stable id; used as the matrix key and the generated job name. */
  id: string;
  /** Example workflow file, relative to examples/ci/<id>/. */
  workflow: string;
  /**
   * Job whose setup steps to extract. The terminal `releasekit ...` step and the
   * example's own `actions/checkout` are dropped by the extractor; everything in
   * between (pnpm/action-setup, setup-node, rust-toolchain, pnpm install, rm -f
   * .npmrc, git config, ...) is kept verbatim.
   */
  job: string;
  /** Shipped config copied into the throwaway fixture. */
  config: string;
  /** Fixture layout the example assumes. */
  fixture: 'npm-single' | 'npm-monorepo' | 'npm-cargo-monorepo';
  /**
   * releasekit subcommand + flags appended after `--dry-run`. The example's own
   * terminal step is replaced with this so publish/event/secret paths stay out of
   * scope while the real setup is still exercised.
   */
  releaseArgs: string[];
  /** One-line note shown in the job log explaining what this scenario proves. */
  proves: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'minimal',
    workflow: 'release.yml',
    job: 'release',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--dry-run'],
    proves: 'pnpm + Node setup resolve; direct dry-run release reaches publish.',
  },
  {
    id: 'label-driven',
    workflow: 'release.yml',
    job: 'release',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--dry-run'],
    proves: 'label-driven setup matches minimal; the label gate is an event guard (out of scope).',
  },
  {
    id: 'oidc',
    workflow: 'release.yml',
    job: 'release',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--dry-run'],
    proves: 'OIDC setup (incl. .npmrc removal) resolves; the OIDC exchange itself is dry-run only.',
  },
  {
    id: 'monorepo-rust',
    workflow: 'release.yml',
    job: 'release',
    config: 'releasekit.config.json',
    fixture: 'npm-cargo-monorepo',
    releaseArgs: ['release', '--dry-run'],
    proves: 'rust-toolchain provides cargo (the cargo: command not found class); npm + cargo dry-run.',
  },
  {
    id: 'prerelease',
    workflow: 'prerelease.yml',
    job: 'prerelease',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--prerelease', 'beta', '--dry-run'],
    proves: 'manual prerelease setup resolves; dry-run produces a -beta.N version.',
  },
  {
    id: 'standing-pr',
    workflow: 'standing-pr.yml',
    job: 'update',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    // standing-pr update mutates a real PR via the GitHub API (out of scope). We
    // extract its setup and probe the environment with a plain dry-run release so
    // the missing-tool class is still covered without the API-mutating path.
    releaseArgs: ['release', '--dry-run'],
    proves: 'standing-pr update setup resolves; the PR-mutating API path stays out of scope.',
  },
];
