import { ReleaseKitError } from '@releasekit/core';
import type { PublishOutput } from '../types.js';

export class BasePublishError extends ReleaseKitError {
  readonly code: string;
  readonly suggestions: string[];

  constructor(message: string, code: string, suggestions?: string[]) {
    super(message);
    this.code = code;
    this.suggestions = suggestions ?? [];
  }

  static isPublishError(error: unknown): error is BasePublishError {
    return error instanceof BasePublishError;
  }
}

export class PublishError extends BasePublishError {}

export class PipelineError extends BasePublishError {
  readonly partialOutput: PublishOutput;
  readonly failedStage: string;
  override readonly cause?: Error;

  constructor(message: string, failedStage: string, partialOutput: PublishOutput, cause?: Error) {
    super(message, PublishErrorCode.PIPELINE_STAGE_ERROR, [
      'Check the partial output for results from stages that completed before the failure',
      'Use --json to get structured error output with partial results',
    ]);
    this.failedStage = failedStage;
    this.partialOutput = partialOutput;
    this.cause = cause;
  }
}

export enum PublishErrorCode {
  INPUT_PARSE_ERROR = 'INPUT_PARSE_ERROR',
  INPUT_VALIDATION_ERROR = 'INPUT_VALIDATION_ERROR',
  CONFIG_ERROR = 'CONFIG_ERROR',
  GIT_COMMIT_ERROR = 'GIT_COMMIT_ERROR',
  GIT_TAG_ERROR = 'GIT_TAG_ERROR',
  GIT_PUSH_ERROR = 'GIT_PUSH_ERROR',
  NPM_PUBLISH_ERROR = 'NPM_PUBLISH_ERROR',
  NPM_AUTH_ERROR = 'NPM_AUTH_ERROR',
  CARGO_PUBLISH_ERROR = 'CARGO_PUBLISH_ERROR',
  CARGO_AUTH_ERROR = 'CARGO_AUTH_ERROR',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  GITHUB_RELEASE_ERROR = 'GITHUB_RELEASE_ERROR',
  FILE_COPY_ERROR = 'FILE_COPY_ERROR',
  CARGO_TOML_ERROR = 'CARGO_TOML_ERROR',
  PIPELINE_STAGE_ERROR = 'PIPELINE_STAGE_ERROR',
}

export function createPublishError(code: PublishErrorCode, details?: string): PublishError {
  const messages: Record<PublishErrorCode, string> = {
    [PublishErrorCode.INPUT_PARSE_ERROR]: 'Failed to parse version output',
    [PublishErrorCode.INPUT_VALIDATION_ERROR]: 'Version output validation failed',
    [PublishErrorCode.CONFIG_ERROR]: 'Invalid publish configuration',
    [PublishErrorCode.GIT_COMMIT_ERROR]: 'Failed to create git commit',
    [PublishErrorCode.GIT_TAG_ERROR]: 'Failed to create git tag',
    [PublishErrorCode.GIT_PUSH_ERROR]: 'Failed to push to remote',
    [PublishErrorCode.NPM_PUBLISH_ERROR]: 'Failed to publish to npm',
    [PublishErrorCode.NPM_AUTH_ERROR]: 'NPM authentication failed',
    [PublishErrorCode.CARGO_PUBLISH_ERROR]: 'Failed to publish to crates.io',
    [PublishErrorCode.CARGO_AUTH_ERROR]: 'Cargo authentication failed',
    [PublishErrorCode.VERIFICATION_FAILED]: 'Package verification failed',
    [PublishErrorCode.GITHUB_RELEASE_ERROR]: 'Failed to create GitHub release',
    [PublishErrorCode.FILE_COPY_ERROR]: 'Failed to copy files',
    [PublishErrorCode.CARGO_TOML_ERROR]: 'Failed to update Cargo.toml',
    [PublishErrorCode.PIPELINE_STAGE_ERROR]: 'Pipeline stage failed',
  };

  const suggestions: Record<PublishErrorCode, string[] | undefined> = {
    [PublishErrorCode.INPUT_PARSE_ERROR]: [
      'Ensure the input is valid JSON from @releasekit/version --json',
      'Check that stdin is piped correctly or --input path is valid',
    ],
    [PublishErrorCode.INPUT_VALIDATION_ERROR]: [
      'Ensure the input matches the expected VersionOutput schema',
      'Run @releasekit/version with --json to generate valid output',
    ],
    [PublishErrorCode.CONFIG_ERROR]: [
      'Validate publish.config.json syntax',
      'Check configuration against the schema',
      'Review documentation for valid configuration options',
    ],
    [PublishErrorCode.GIT_COMMIT_ERROR]: [
      'Ensure there are staged changes to commit',
      'Check git user.name and user.email are configured',
      'Verify you have write access to the repository',
    ],
    [PublishErrorCode.GIT_TAG_ERROR]: [
      'Check if the tag already exists: git tag -l <tag>',
      'Delete existing tag if needed: git tag -d <tag>',
    ],
    [PublishErrorCode.GIT_PUSH_ERROR]: [
      'Verify remote repository access',
      'Check SSH key or deploy key configuration',
      'Ensure the branch is not protected or you have push access',
    ],
    [PublishErrorCode.NPM_PUBLISH_ERROR]: [
      'Check npm registry availability',
      'Verify package name is not already taken by another owner',
      'Ensure package version has not already been published',
    ],
    [PublishErrorCode.NPM_AUTH_ERROR]: [
      'Set NPM_TOKEN environment variable for token-based auth',
      'Enable OIDC trusted publishing in GitHub Actions for provenance',
      'Run npm login for local publishing',
    ],
    [PublishErrorCode.CARGO_PUBLISH_ERROR]: [
      'Check crates.io registry availability',
      'Verify crate name ownership on crates.io',
      'Ensure Cargo.toml metadata is complete (description, license, etc.)',
    ],
    [PublishErrorCode.CARGO_AUTH_ERROR]: [
      'Set CARGO_REGISTRY_TOKEN environment variable',
      'Generate a token at https://crates.io/settings/tokens',
    ],
    [PublishErrorCode.VERIFICATION_FAILED]: [
      'Registry propagation may take longer than expected',
      'Try increasing verify.maxAttempts or verify.initialDelay in config',
      'Check registry status pages for outages',
    ],
    [PublishErrorCode.GITHUB_RELEASE_ERROR]: [
      'Ensure gh CLI is installed and authenticated',
      'Verify GITHUB_TOKEN has contents:write permission',
      'Check that the tag exists in the remote repository',
    ],
    [PublishErrorCode.FILE_COPY_ERROR]: ['Verify the source file exists in the project root', 'Check file permissions'],
    [PublishErrorCode.CARGO_TOML_ERROR]: [
      'Ensure Cargo.toml exists and is valid TOML',
      'Check that the [package] section has a version field',
    ],
    [PublishErrorCode.PIPELINE_STAGE_ERROR]: [
      'Check the partial output for results from stages that completed before the failure',
      'Use --json to get structured error output with partial results',
    ],
  };

  const baseMessage = messages[code];
  const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;

  return new PublishError(fullMessage, code, suggestions[code]);
}
