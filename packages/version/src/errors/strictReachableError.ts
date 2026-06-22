import { BaseVersionError } from './baseError.js';

/**
 * Thrown by {@link BaselineResolver.resolve} when `version.strictReachable` is set and a baseline ref
 * is not reachable from HEAD (typically a shallow clone / `fetch-depth` misconfiguration).
 *
 * It is a distinct type purely so the per-package changelog `try/catch` in each strategy can tell it
 * apart from a genuine changelog-extraction failure: genuine failures degrade to a minimal entry and
 * the run continues, but this one is **rethrown** so it aborts the whole run — which is the entire
 * point of `strictReachable` (surface the misconfiguration loudly, don't ship a silently-degraded
 * whole-history changelog on a green run). See #372.
 */
export class StrictReachableError extends BaseVersionError {
  constructor(message: string) {
    super(message, 'STRICT_REACHABLE_UNREACHABLE');
  }
}
