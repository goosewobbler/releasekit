import type { VersionOutput } from '@releasekit/core';
import type { PublishOutput } from '@releasekit/publish';

export interface ReleaseOptions {
  config?: string;
  dryRun: boolean;
  bump?: string;
  prerelease?: string | boolean;
  sync: boolean;
  target?: string;
  skipNotes: boolean;
  skipPublish: boolean;
  skipGit: boolean;
  skipGithubRelease: boolean;
  skipVerification: boolean;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  projectDir: string;
}

export interface ReleaseOutput {
  versionOutput: VersionOutput;
  notesGenerated: boolean;
  packageNotes?: Record<string, string>;
  publishOutput?: PublishOutput;
}
