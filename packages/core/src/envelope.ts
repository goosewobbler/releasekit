import { EXIT_CODES, type ExitCode, ReleaseKitError } from './errors.js';

/** Bumped only on a breaking change to the envelope shape, so agents and CI can pin against it. */
export const ENVELOPE_SCHEMA_VERSION = 1;

export type EnvelopeStatus = 'success' | 'error';

export interface EnvelopeError {
  code: string;
  /** The code's exit-code family, e.g. `config`. */
  category: string;
  /** Only true when the failure is known to be transient. */
  retryable: boolean;
  message: string;
}

export interface EnvelopeWarning {
  code?: string;
  message: string;
}

/** `data` is the command's payload verbatim, never reshaped, so the manifest-compat invariant holds. */
export interface Envelope<T = unknown> {
  schemaVersion: number;
  status: EnvelopeStatus;
  changed: boolean;
  data: T;
  warnings: EnvelopeWarning[];
  errors: EnvelopeError[];
}

export function successEnvelope<T>(
  data: T,
  opts: { changed?: boolean; warnings?: EnvelopeWarning[] } = {},
): Envelope<T> {
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    status: 'success',
    changed: opts.changed ?? false,
    data,
    warnings: opts.warnings ?? [],
    errors: [],
  };
}

export function errorEnvelope<T = null>(
  errors: EnvelopeError[],
  opts: { warnings?: EnvelopeWarning[]; data?: T; changed?: boolean } = {},
): Envelope<T | null> {
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    status: 'error',
    // Progress made before the failure, e.g. what a partial publish landed.
    changed: opts.changed ?? false,
    data: opts.data ?? null,
    warnings: opts.warnings ?? [],
    errors,
  };
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' && value !== null && 'schemaVersion' in value && 'status' in value && 'data' in value
  );
}

const KNOWN_STATUSES = new Set<EnvelopeStatus>(['success', 'error']);

/** Returns an envelope's `data`, or a bare payload as is; throws on a newer, failed or empty envelope. */
export function unwrapEnvelope(value: unknown): unknown {
  if (!isEnvelope(value)) {
    return value;
  }

  if (typeof value.schemaVersion !== 'number' || value.schemaVersion > ENVELOPE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported releasekit envelope schemaVersion ${String(value.schemaVersion)} (this build understands ` +
        `up to ${ENVELOPE_SCHEMA_VERSION}). Upgrade the consuming releasekit to match the producer.`,
    );
  }

  if (!KNOWN_STATUSES.has(value.status)) {
    throw new Error(`Unrecognised releasekit envelope status "${String(value.status)}".`);
  }

  if (value.status === 'error') {
    const first = value.errors?.[0];
    throw new Error(
      first
        ? `Upstream releasekit stage failed (${first.code}): ${first.message}`
        : 'Upstream releasekit stage failed, but reported no error detail.',
    );
  }

  if (value.data === null || value.data === undefined) {
    throw new Error('Upstream releasekit stage reported success but produced no data.');
  }

  return value.data;
}

type ErrorExitCode = Exclude<ExitCode, typeof EXIT_CODES.SUCCESS>;

/** Documented in docs/cli.md. */
const CODE_TO_EXIT: Record<string, ErrorExitCode> = {
  CONFIG_ERROR: EXIT_CODES.CONFIG_ERROR,
  INPUT_ERROR: EXIT_CODES.INPUT_ERROR,
  INPUT_PARSE_ERROR: EXIT_CODES.INPUT_ERROR,
  INPUT_VALIDATION_ERROR: EXIT_CODES.INPUT_ERROR,
  TEMPLATE_ERROR: EXIT_CODES.TEMPLATE_ERROR,
  LLM_ERROR: EXIT_CODES.LLM_ERROR,
  GITHUB_ERROR: EXIT_CODES.GITHUB_ERROR,
  GIT_ERROR: EXIT_CODES.GIT_ERROR,
  VERSION_ERROR: EXIT_CODES.VERSION_ERROR,
  PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,

  // @releasekit/version: discovery failures mean bad `packages` globs, so they're config errors.
  CONFIG_REQUIRED: EXIT_CODES.CONFIG_ERROR,
  INVALID_CONFIG: EXIT_CODES.CONFIG_ERROR,
  UNSAFE_CONFIG_PATH: EXIT_CODES.CONFIG_ERROR,
  PACKAGES_NOT_FOUND: EXIT_CODES.CONFIG_ERROR,
  PACKAGE_NOT_FOUND: EXIT_CODES.CONFIG_ERROR,
  WORKSPACE_ERROR: EXIT_CODES.CONFIG_ERROR,
  NOT_GIT_REPO: EXIT_CODES.GIT_ERROR,
  GIT_PROCESS_ERROR: EXIT_CODES.GIT_ERROR,
  TAG_ALREADY_EXISTS: EXIT_CODES.GIT_ERROR,
  VERSION_CALCULATION_ERROR: EXIT_CODES.VERSION_ERROR,
  STRICT_REACHABLE_UNREACHABLE: EXIT_CODES.VERSION_ERROR,
  NO_COMMIT_MESSAGE: EXIT_CODES.VERSION_ERROR,
  NO_FILES: EXIT_CODES.VERSION_ERROR,
  CARGO_LOCK_SYNC_ERROR: EXIT_CODES.VERSION_ERROR,

  // @releasekit/publish
  PIPELINE_STAGE_ERROR: EXIT_CODES.PUBLISH_ERROR,
  NPM_AUTH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  NPM_PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  CARGO_AUTH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  CARGO_PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  PUB_AUTH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  PUB_PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  FILE_COPY_ERROR: EXIT_CODES.PUBLISH_ERROR,
  VERIFICATION_FAILED: EXIT_CODES.PUBLISH_ERROR,
  // A malformed manifest is a config error.
  CARGO_TOML_ERROR: EXIT_CODES.CONFIG_ERROR,
  PUBSPEC_YAML_ERROR: EXIT_CODES.CONFIG_ERROR,
  GIT_COMMIT_ERROR: EXIT_CODES.GIT_ERROR,
  GIT_PUSH_ERROR: EXIT_CODES.GIT_ERROR,
  GIT_TAG_ERROR: EXIT_CODES.GIT_ERROR,
  GITHUB_RELEASE_ERROR: EXIT_CODES.GITHUB_ERROR,
};

export function exitCodeForError(error: unknown): number {
  if (ReleaseKitError.isReleaseKitError(error)) {
    return CODE_TO_EXIT[error.code] ?? EXIT_CODES.GENERAL_ERROR;
  }
  return EXIT_CODES.GENERAL_ERROR;
}

const CATEGORY_FOR_EXIT: Record<ErrorExitCode, string> = {
  [EXIT_CODES.GENERAL_ERROR]: 'general',
  [EXIT_CODES.CONFIG_ERROR]: 'config',
  [EXIT_CODES.INPUT_ERROR]: 'input',
  [EXIT_CODES.TEMPLATE_ERROR]: 'template',
  [EXIT_CODES.LLM_ERROR]: 'llm',
  [EXIT_CODES.GITHUB_ERROR]: 'github',
  [EXIT_CODES.GIT_ERROR]: 'git',
  [EXIT_CODES.VERSION_ERROR]: 'version',
  [EXIT_CODES.PUBLISH_ERROR]: 'publish',
};

function categoryForCode(code: string): string {
  return CATEGORY_FOR_EXIT[CODE_TO_EXIT[code] ?? EXIT_CODES.GENERAL_ERROR];
}

export function toEnvelopeError(error: unknown): EnvelopeError {
  if (ReleaseKitError.isReleaseKitError(error)) {
    return {
      code: error.code,
      category: categoryForCode(error.code),
      // Only ReleaseKitError subclasses that classify transience (LLMError) carry this.
      retryable: (error as { retryable?: boolean }).retryable === true,
      message: error.message,
    };
  }
  return {
    code: 'GENERAL_ERROR',
    category: 'general',
    retryable: false,
    message: error instanceof Error ? error.message : String(error),
  };
}
