/**
 * Deliberately metadata, not a mirror of the example steps: the steps are
 * extracted from the example YAML by generate-smoke-workflow.ts.
 */

export interface Scenario {
  /** Stable id; used as the matrix key and the generated job name. */
  id: string;
  /** Relative to examples/ci/<id>/. */
  workflow: string;
  /**
   * Job whose setup steps to extract. The extractor drops the example's
   * `actions/checkout` and stops at `releaseStep`; everything between is kept verbatim.
   */
  job: string;
  /** `name` of the job's releasekit step, which `releaseArgs` replace. */
  releaseStep: string;
  /** Shipped config copied into the throwaway fixture. */
  config: string;
  fixture: 'npm-single' | 'npm-monorepo' | 'npm-cargo-monorepo';
  /** releasekit subcommand & flags (always including `--dry-run`) that replace `releaseStep`. */
  releaseArgs: string[];
  /** One-line note shown in the job log. */
  proves: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'minimal',
    workflow: 'release.yml',
    job: 'release',
    releaseStep: 'Release',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--dry-run'],
    proves: 'pnpm + Node setup resolve; direct dry-run release reaches publish.',
  },
  {
    id: 'label-driven',
    workflow: 'release.yml',
    job: 'release',
    releaseStep: 'Release',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--dry-run'],
    proves: 'label-driven setup matches minimal; the label gate is an event guard (out of scope).',
  },
  {
    id: 'oidc',
    workflow: 'release.yml',
    job: 'release',
    releaseStep: 'Release',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--dry-run'],
    proves: 'OIDC setup (incl. .npmrc removal) resolves; the OIDC exchange itself is dry-run only.',
  },
  {
    id: 'monorepo-rust',
    workflow: 'release.yml',
    job: 'release',
    releaseStep: 'Release',
    config: 'releasekit.config.json',
    fixture: 'npm-cargo-monorepo',
    releaseArgs: ['release', '--dry-run'],
    proves: 'rust-toolchain provides cargo (the cargo: command not found class); npm + cargo dry-run.',
  },
  {
    id: 'prerelease',
    workflow: 'prerelease.yml',
    job: 'prerelease',
    releaseStep: 'Prerelease',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['release', '--prerelease', 'beta', '--dry-run'],
    proves: 'manual prerelease setup resolves; dry-run produces a -beta.N version.',
  },
  {
    id: 'standing-pr',
    workflow: 'standing-pr.yml',
    job: 'update',
    releaseStep: 'Update standing release PR',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    // standing-pr update mutates a real PR via the GitHub API, so probe the environment with a
    // plain dry-run release instead.
    releaseArgs: ['release', '--dry-run'],
    proves: 'standing-pr update setup resolves; the PR-mutating API path stays out of scope.',
  },
  {
    id: 'release-preview',
    workflow: 'release-preview.yml',
    job: 'preview',
    releaseStep: 'Post release preview',
    config: 'releasekit.config.json',
    fixture: 'npm-single',
    releaseArgs: ['preview', '--dry-run'],
    proves: 'preview setup resolves; dry-run renders the comment without posting it.',
  },
];
