import type { VersionOutput } from '@releasekit/core';
import type { PublishOutput } from '@releasekit/publish';

export interface ReleaseOptions {
  config?: string;
  dryRun: boolean;
  bump?: string;
  prerelease?: string | boolean;
  stable?: boolean;
  /** Per-package graduation (#486): package name patterns to graduate to stable, leaving other
   *  prereleases on their line. Distinct from `stable`, which graduates ALL prereleases. */
  graduate?: string[];
  /** Per-package prerelease (#521): package name patterns to shift onto a prerelease line, leaving
   *  every other package on its projected version. The symmetric twin of `graduate`; distinct from
   *  `prerelease`, which shifts ALL packages. */
  prereleaseScope?: string[];
  /** Acknowledge a first-release bump on an already-stable manifest (silences the #388 overshoot guard). */
  allowFirstBump?: boolean;
  sync: boolean;
  target?: string;
  /** Also release the changed internal dependencies of `target` packages (and the rest of their groups). */
  includePrerequisites?: boolean;
  /** Package names to drop from the release set (standing-PR ad-hoc deselection). Exact name match. */
  exclude?: string[];
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
  /**
   * Per-package human-edited release notes that win over freshly generated notes (edited wins per
   * package, new packages fall back to fresh). Set by the manual-mode draft dispatch (#319) from the
   * edited tracking-issue body; not a CLI flag.
   */
  editedNotes?: Record<string, string>;
}

export interface ReleaseOutput {
  versionOutput: VersionOutput;
  notesGenerated: boolean;
  packageNotes?: Record<string, string>;
  releaseNotes?: Record<string, string>;
  publishOutput?: PublishOutput;
}
