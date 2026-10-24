import type { VersionOutput } from '@releasekit/core';
import type { PublishOutput } from '@releasekit/publish';

export interface ReleaseOptions {
  config?: string;
  dryRun: boolean;
  bump?: string;
  prerelease?: string | boolean;
  stable?: boolean;
  /** Package patterns to graduate to stable; `stable` graduates every prerelease. */
  graduate?: string[];
  /** Package patterns to shift onto a prerelease line; `prerelease` shifts every package. */
  prereleaseScope?: string[];
  /** Acknowledge a first-release bump on an already-stable manifest (silences the overshoot guard). */
  allowFirstBump?: boolean;
  sync: boolean;
  target?: string;
  /** Also release the changed internal dependencies of `target` packages (and the rest of their groups). */
  includePrerequisites?: boolean;
  /** Matched by exact package name. */
  exclude?: string[];
  scope?: string;
  branch?: string;
  skipNotes: boolean;
  /** Release notes only (LLM & per-version notes files); CHANGELOG.md is still written. */
  skipReleaseNotes?: boolean;
  /** CHANGELOG.md only; release notes are still generated. */
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
  /** When set, scope commit analysis (bump type & changelog) to commits after this SHA. */
  baseRef?: string;
  /** Wins per package over generated notes. Set by the draft dispatch; not a CLI flag. */
  editedNotes?: Record<string, string>;
}

export interface ReleaseOutput {
  versionOutput: VersionOutput;
  notesGenerated: boolean;
  packageNotes?: Record<string, string>;
  releaseNotes?: Record<string, string>;
  publishOutput?: PublishOutput;
}
