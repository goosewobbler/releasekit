import { EXIT_CODES, ReleaseKitError } from '@releasekit/core';

export abstract class NotesError extends ReleaseKitError {}

export class InputParseError extends NotesError {
  readonly code = 'INPUT_PARSE_ERROR';
  readonly suggestions = [
    'Ensure input is valid JSON',
    'Check that input matches expected schema',
    'Use --input-source to specify format',
  ];
}

export class TemplateError extends NotesError {
  readonly code = 'TEMPLATE_ERROR';
  readonly suggestions = [
    'Check template syntax',
    'Ensure all required files exist (document, version, entry)',
    'Verify template engine matches file extension',
  ];
}

export class LLMError extends NotesError {
  readonly code = 'LLM_ERROR';
  readonly suggestions = [
    'Check API key is configured',
    'Verify model name is correct',
    'Check network connectivity',
    'Try with --no-llm to skip LLM processing',
  ];

  /**
   * Whether the underlying failure is transient and worth retrying (timeout / 429 / 5xx / network).
   * `false` marks a non-retryable failure (4xx auth/validation) so `withRetry` fails fast instead of
   * burning the whole backoff budget. `undefined` means "unclassified" — callers retry by default.
   */
  readonly retryable?: boolean;

  constructor(message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message);
    // Chain the original provider/SDK error so its stack survives (the message only carries its text).
    if (options?.cause !== undefined) this.cause = options.cause;
    this.retryable = options?.retryable;
  }
}

export class GitHubError extends NotesError {
  readonly code = 'GITHUB_ERROR';
  readonly suggestions = [
    'Ensure GITHUB_TOKEN is set',
    'Check token has repo scope',
    'Verify repository exists and is accessible',
  ];
}

export class ConfigError extends NotesError {
  readonly code = 'CONFIG_ERROR';
  readonly suggestions = [
    'Check config file syntax',
    'Verify all required fields are present',
    'Run releasekit-notes init to create default config',
  ];
}

export function getExitCode(error: NotesError): number {
  switch (error.code) {
    case 'CONFIG_ERROR':
      return EXIT_CODES.CONFIG_ERROR;
    case 'INPUT_PARSE_ERROR':
      return EXIT_CODES.INPUT_ERROR;
    case 'TEMPLATE_ERROR':
      return EXIT_CODES.TEMPLATE_ERROR;
    case 'LLM_ERROR':
      return EXIT_CODES.LLM_ERROR;
    case 'GITHUB_ERROR':
      return EXIT_CODES.GITHUB_ERROR;
    default:
      return EXIT_CODES.GENERAL_ERROR;
  }
}
