export interface ActionInputs {
  mode?: 'release' | 'preview' | 'gate' | string;
  config?: string;
  projectDir?: string;
  dryRun?: string;
  json?: string;
  verbose?: string;
  quiet?: string;
  summary?: string;
  bump?: string;
  prerelease?: string;
  sync?: string;
  target?: string;
  scope?: string;
  branch?: string;
  npmAuth?: string;
  skipNotes?: string;
  skipPublish?: string;
  skipGit?: string;
  skipGithubRelease?: string;
  skipVerification?: string;
  pr?: string;
  repo?: string;
  previewPrerelease?: string;
  previewStable?: string;
  previewDryRun?: string;
}

export interface RunActionOptions {
  cliPath?: string;
}

export function buildReleaseArgs(input: ActionInputs): string[];
export function buildPreviewArgs(input: ActionInputs): string[];
export function parseReleaseOutput(
  stdout: string,
): { versionOutput?: { tags?: string[]; updates?: unknown[] } } | undefined;
export function parseInputs(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): ActionInputs;
export function runAction(
  input: ActionInputs,
  options?: RunActionOptions,
): {
  mode: string;
  args: string[];
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};
