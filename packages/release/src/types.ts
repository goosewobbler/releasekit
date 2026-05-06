import type { VersionOutput } from '@releasekit/core';
import type { PublishOutput } from '@releasekit/publish';

export interface ReleaseOptions {
  config?: string;
  dryRun: boolean;
  bump?: string;
  prerelease?: string | boolean;
  stable?: boolean;
  sync: boolean;
  target?: string;
  scope?: string;
  branch?: string;
  skipNotes: boolean;
  /**
   * Skip release-notes generation (LLM + RELEASE_NOTES.md write) inside the notes step.
   * Per-package CHANGELOG.md is unaffected. Used by the standing-pr update path so the
   * standing-pr workflow doesn't depend on LLM availability and doesn't re-pay for an
   * LLM call on every push to main.
   */
  skipReleaseNotes?: boolean;
  /**
   * Skip changelog file writes (CHANGELOG.md) inside the notes step. LLM + release-notes
   * generation are unaffected. Used by `publishFromManifest` to regenerate only the
   * release notes against an already-bumped tree.
   */
  skipChangelogs?: boolean;
  skipPublish: boolean;
  skipGit: boolean;
  skipGitCommit?: boolean;
  skipGithubRelease: boolean;
  skipVerification: boolean;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  projectDir: string;
  npmAuth?: 'auto' | 'oidc' | 'token';
  /** When set, scope commit analysis (bump type + changelog) to commits after this SHA. */
  baseRef?: string;
}

export interface ReleaseOutput {
  versionOutput: VersionOutput;
  notesGenerated: boolean;
  packageNotes?: Record<string, string>;
  releaseNotes?: Record<string, string>;
  publishOutput?: PublishOutput;
}
