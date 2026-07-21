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

export function errorEnvelope(errors: EnvelopeError[], opts: { warnings?: EnvelopeWarning[] } = {}): Envelope<null> {
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    status: 'error',
    changed: false,
    data: null,
    warnings: opts.warnings ?? [],
    errors,
  };
}

const CODE_TO_EXIT: Record<string, number> = {
  CONFIG_ERROR: EXIT_CODES.CONFIG_ERROR,
  INPUT_ERROR: EXIT_CODES.INPUT_ERROR,
  INPUT_PARSE_ERROR: EXIT_CODES.INPUT_ERROR,
  TEMPLATE_ERROR: EXIT_CODES.TEMPLATE_ERROR,
  LLM_ERROR: EXIT_CODES.LLM_ERROR,
  GITHUB_ERROR: EXIT_CODES.GITHUB_ERROR,
  GIT_ERROR: EXIT_CODES.GIT_ERROR,
  VERSION_ERROR: EXIT_CODES.VERSION_ERROR,
  PUBLISH_ERROR: EXIT_CODES.PUBLISH_ERROR,
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
