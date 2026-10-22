import { EXIT_CODES, ReleaseKitError } from './errors.js';

/**
 * Version of the `--json` envelope contract. Bumped only on a breaking change to the envelope
 * shape, and stable across minor releases, so agents and CI can pin against it.
 */
export const ENVELOPE_SCHEMA_VERSION = 1;

export type EnvelopeStatus = 'success' | 'error';

export interface EnvelopeError {
  /** Stable machine code mirroring `ReleaseKitError.code` (e.g. CONFIG_ERROR, LLM_ERROR). */
  code: string;
  /** Coarse grouping derived from the code (e.g. config, llm, github). */
  category: string;
  /** Whether the failure is transient and worth retrying. Only true when known-transient. */
  retryable: boolean;
  message: string;
}

export interface EnvelopeWarning {
  code?: string;
  message: string;
}

/**
 * The uniform result envelope every command emits in `--json` mode. `data` carries the
 * command-specific payload (VersionOutput, gate result, standing-PR result) verbatim — the
 * envelope wraps it, never replaces it, so the manifest-compat invariant holds.
 */
export interface Envelope<T = unknown> {
  schemaVersion: number;
  status: EnvelopeStatus;
  /** Whether the command changed state, vs. found everything already in the desired state. */
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

/**
 * `data` and `changed` are for commands that fail partway with progress to report: a publish that
 * failed after landing some packages knows what landed, and the retry needs it.
 */
export function errorEnvelope<T = null>(
  errors: EnvelopeError[],
  opts: { warnings?: EnvelopeWarning[]; data?: T; changed?: boolean } = {},
): Envelope<T | null> {
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    status: 'error',
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

/**
 * Unwrap a piped envelope to its payload; a bare payload passes through unchanged, so a
 * hand-assembled input or an older releasekit still works. Throws on anything unusable, so the error
 * names the cause instead of surfacing later as a shape error about the payload.
 */
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

/**
 * The documented code → exit-code table (docs/cli.md): every specific code maps to one of the nine
 * families, so automation can branch on the exit code instead of getting the generic 1.
 */
const CODE_TO_EXIT: Record<string, number> = {
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

  // @releasekit/version. Config and workspace discovery are configuration problems (the `packages`
  // globs matched nothing, or the config is unreadable); the rest are git or versioning failures.
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

  // @releasekit/publish. Registry auth and publish failures are publish errors; a malformed package
  // manifest is a configuration problem; the git and GitHub stages map to their own families.
  PIPELINE_STAGE_ERROR: EXIT_CODES.PUBLISH_ERROR,
  NPM_AUTH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  NPM_PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  CARGO_AUTH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  CARGO_PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  PUB_AUTH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  PUB_PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,
  FILE_COPY_ERROR: EXIT_CODES.PUBLISH_ERROR,
  VERIFICATION_FAILED: EXIT_CODES.PUBLISH_ERROR,
  CARGO_TOML_ERROR: EXIT_CODES.CONFIG_ERROR,
  PUBSPEC_YAML_ERROR: EXIT_CODES.CONFIG_ERROR,
  GIT_COMMIT_ERROR: EXIT_CODES.GIT_ERROR,
  GIT_PUSH_ERROR: EXIT_CODES.GIT_ERROR,
  GIT_TAG_ERROR: EXIT_CODES.GIT_ERROR,
  GITHUB_RELEASE_ERROR: EXIT_CODES.GITHUB_ERROR,
};

/** Map any thrown value to its process exit code, defaulting to GENERAL_ERROR. */
export function exitCodeForError(error: unknown): number {
  if (ReleaseKitError.isReleaseKitError(error)) {
    return CODE_TO_EXIT[error.code] ?? EXIT_CODES.GENERAL_ERROR;
  }
  return EXIT_CODES.GENERAL_ERROR;
}

/** Derive a coarse category from a code: CONFIG_ERROR -> config, INPUT_PARSE_ERROR -> input-parse. */
function categoryForCode(code: string): string {
  return (
    code
      .replace(/_ERROR$/, '')
      .replace(/_/g, '-')
      .toLowerCase() || 'general'
  );
}

/** Convert a thrown value into a structured envelope error. */
export function toEnvelopeError(error: unknown): EnvelopeError {
  if (ReleaseKitError.isReleaseKitError(error)) {
    return {
      code: error.code,
      category: categoryForCode(error.code),
      // Only ReleaseKitError subclasses that classify transience (LLMError) carry this; a missing or
      // undefined flag stays conservatively non-retryable so an agent never retries an unknown failure.
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
