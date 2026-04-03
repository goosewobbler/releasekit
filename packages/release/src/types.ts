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
  branch?: string;
  skipNotes: boolean;
  skipPublish: boolean;
  skipGit: boolean;
  skipGithubRelease: boolean;
  skipVerification: boolean;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  projectDir: string;
  npmAuth?: 'auto' | 'oidc' | 'token';
}

export interface ReleaseOutput {
  versionOutput: VersionOutput;
  notesGenerated: boolean;
  packageNotes?: Record<string, string>;
  releaseNotes?: Record<string, string>;
  publishOutput?: PublishOutput;
}
