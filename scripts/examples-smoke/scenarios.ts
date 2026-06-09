/**
 * Scenario manifest for the examples execution smoke-test (issue #276).
 *
 * Deliberately METADATA, not a mirror of the example steps: it names which
 * example workflow/job to EXTRACT setup steps from, which shipped config the
 * fixture uses, the fixture shape, and the (always `--dry-run`) releasekit
 * invocation. The steps themselves are read out of the example YAML at
 * generation time, so they can't drift — CI runs the generator with `--check`.
 */

export interface Scenario {
  /** Stable id; used as the matrix key and the generated job name. */
  id: string;
  /** Example workflow file, relative to examples/ci/<id>/. */
  workflow: string;
  /**
   * Job whose setup steps to extract. The extractor drops the terminal
   * `releasekit ...` step and the example's `actions/checkout`; everything
   * between is kept verbatim.
   */
  job: string;
  /** Shipped config copied into the throwaway fixture. */
  config: string;
  /** Fixture layout the example assumes. */
  fixture: 'npm-single' | 'npm-monorepo' | 'npm-cargo-monorepo';
  /** releasekit subcommand + flags (always including `--dry-run`) that replaces the example's terminal step. */
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
    // standing-pr update mutates a real PR via the GitHub API (out of scope), so probe the
    // environment with a plain dry-run release instead of the real `standing-pr update`.
    releaseArgs: ['release', '--dry-run'],
    proves: 'standing-pr update setup resolves; the PR-mutating API path stays out of scope.',
  },
];
